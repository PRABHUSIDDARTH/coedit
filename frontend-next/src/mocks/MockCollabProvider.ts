import type {
  CollabProvider, Collaborator, ConnectionState, DocKind, DocUpdate, PresenceEvent, Position, Unsubscribe,
} from "@/lib/collab/types";
import { TEAMMATES } from "./people";

const PHRASES = [
  "Added the Q4 follow-up as a separate row.",
  "Worth confirming this with finance first.",
  "Moved to Friday so support can review.",
  "Checked against last quarter and it holds.",
];

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]): T => a[rand(a.length)];

/** Simulates 2 to 3 collaborators who join one after another, move around and occasionally type.
 *  A real provider implements the same interface over Yjs and a WebSocket. */
export class MockCollabProvider implements CollabProvider {
  private kind: DocKind = "doc";
  private presenceCbs = new Set<(e: PresenceEvent) => void>();
  private updateCbs = new Set<(u: DocUpdate) => void>();
  private stateCbs = new Set<(s: ConnectionState) => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private last = new Map<string, PresenceEvent>();

  async connect(_docId: string, kind: DocKind): Promise<void> {
    this.disconnect();
    this.kind = kind;
    this.emitState("connecting");
    this.later(450, () => this.emitState("connected"));
    const crew = TEAMMATES.slice(0, kind === "canvas" ? 2 : 3);
    crew.forEach((c, i) => {
      this.later(900 + i * 1100, () => this.join(c));
    });
  }

  disconnect(): void {
    this.timers.forEach(clearTimeout);
    this.intervals.forEach(clearInterval);
    this.timers = [];
    this.intervals = [];
    this.last.clear();
    this.emitState("offline");
  }

  onPresence(cb: (e: PresenceEvent) => void): Unsubscribe {
    this.presenceCbs.add(cb);
    return () => this.presenceCbs.delete(cb);
  }
  onUpdate(cb: (u: DocUpdate) => void): Unsubscribe {
    this.updateCbs.add(cb);
    return () => this.updateCbs.delete(cb);
  }
  onState(cb: (s: ConnectionState) => void): Unsubscribe {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }
  sendUpdate(): void {
    /* The mock has no other clients to deliver to. */
  }
  peers(): PresenceEvent[] {
    return [...this.last.values()];
  }

  private join(c: Collaborator) {
    this.present(c, this.position(), false);
    this.intervals.push(setInterval(() => this.present(c, this.position(), false), 1800 + rand(1600)));
    // One short burst of typing every so often.
    this.intervals.push(setInterval(() => this.type(c), 14000 + rand(8000)));
    this.later(5000 + rand(5000), () => this.type(c));
  }

  private position(): Position {
    if (this.kind === "sheet") return { kind: "sheet", row: rand(7), col: rand(9) };
    if (this.kind === "canvas") return { kind: "canvas", x: 80 + rand(820), y: 60 + rand(300) };
    return { kind: "doc", pos: 4 + rand(900) }; // the editor clamps to the document size
  }

  private type(c: Collaborator) {
    this.present(c, this.last.get(c.id)?.position ?? this.position(), true);
    this.later(2200, () => {
      this.present(c, this.last.get(c.id)?.position ?? null, false);
      if (this.kind === "doc") this.update(c, { op: "append-paragraph", text: pick(PHRASES), author: c.name });
      if (this.kind === "sheet") this.update(c, { op: "set-note", row: rand(6), text: pick(PHRASES) });
    });
  }

  private present(collaborator: Collaborator, position: Position | null, typing: boolean) {
    const e: PresenceEvent = { collaborator, position, typing };
    this.last.set(collaborator.id, e);
    this.presenceCbs.forEach((cb) => cb(e));
  }
  private update(c: Collaborator, payload: unknown) {
    const u: DocUpdate = { origin: c.id, kind: this.kind, payload };
    this.updateCbs.forEach((cb) => cb(u));
  }
  private emitState(s: ConnectionState) {
    this.stateCbs.forEach((cb) => cb(s));
  }
  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }
}
