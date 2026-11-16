/** Debounced autosave as a small state machine, independent of React so it can be tested with fake timers.
 *  `touch()` marks the scene as changed; after `delayMs` of quiet, `produce()` builds the value and `save()` sends it.
 *  Changes that arrive while a save is running are saved right after it. A conflict stops autosave until `resolve*`. */

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "failed" | "conflict";
export interface SaveState { status: SaveStatus; error?: string }

export interface AutosaveOptions<T> {
  /** Builds the value to save and a key; equal keys are not saved twice. */
  produce: () => { value: T; key: string };
  save: (value: T) => Promise<void>;
  isConflict: (error: unknown) => boolean;
  describe: (error: unknown) => string;
  onState: (state: SaveState) => void;
  delayMs?: number;
}

export class Autosaver<T> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private again = false;
  private lastKey: string | null;
  private state: SaveState = { status: "idle" };
  private disposed = false;

  constructor(private readonly o: AutosaveOptions<T>, initialKey: string | null = null) {
    this.lastKey = initialKey;
  }

  get current(): SaveState { return this.state; }
  get hasUnsaved(): boolean { return this.state.status === "dirty" || this.state.status === "saving" || this.state.status === "failed" || this.state.status === "conflict"; }

  private set(state: SaveState) {
    this.state = state;
    if (!this.disposed) this.o.onState(state);
  }

  /** Something changed. Restarts the quiet period. */
  touch(): void {
    if (this.disposed || this.state.status === "conflict") return;
    if (this.state.status === "saving") this.again = true;
    else if (this.state.status !== "dirty") this.set({ status: "dirty" });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), this.o.delayMs ?? 1500);
  }

  /** Save now (also the retry after a failure). */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    return this.run();
  }

  retry(): Promise<void> {
    if (this.state.status === "conflict") return Promise.resolve();
    return this.flush();
  }

  /** Leave the conflict state. `keepLocal` saves the local scene over the server's (the caller has already
   *  re-based its revision); otherwise the caller discards local changes (it reloads the editor). */
  resolveConflict(keepLocal: boolean): Promise<void> {
    this.lastKey = null; // force the next save even if the key equals what was last saved
    if (!keepLocal) { this.set({ status: "idle" }); return Promise.resolve(); }
    this.set({ status: "dirty" });
    return this.flush();
  }

  /** Tell the saver the server now holds this key (e.g. after loading it). */
  markSaved(key: string): void { this.lastKey = key; this.set({ status: "saved" }); }

  private async run(): Promise<void> {
    if (this.disposed) return;
    if (this.running) { this.again = true; return this.running; }
    const { value, key } = this.o.produce();
    if (key === this.lastKey) { if (this.state.status === "dirty" || this.state.status === "failed") this.set({ status: this.lastKey === null ? "idle" : "saved" }); return; }
    this.set({ status: "saving" });
    this.running = (async () => {
      try {
        await this.o.save(value);
        this.lastKey = key;
        this.set(this.again ? { status: "dirty" } : { status: "saved" });
      } catch (e) {
        this.set(this.o.isConflict(e) ? { status: "conflict", error: this.o.describe(e) } : { status: "failed", error: this.o.describe(e) });
        this.again = false;
      } finally {
        this.running = undefined;
      }
      if (this.again && this.state.status === "dirty") { this.again = false; clearTimeout(this.timer); this.timer = setTimeout(() => void this.run(), 0); }
    })();
    return this.running;
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
