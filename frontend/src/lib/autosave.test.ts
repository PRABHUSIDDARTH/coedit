import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver, type SaveState } from "./autosave";

class Conflict extends Error {}

function make(overrides: { save?: (v: string) => Promise<void> } = {}) {
  let value = "v1";
  const states: SaveState[] = [];
  const saved: string[] = [];
  const saver = new Autosaver<string>({
    produce: () => ({ value, key: value }),
    save: overrides.save ?? (async (v) => { saved.push(v); }),
    isConflict: (e) => e instanceof Conflict,
    describe: (e) => (e instanceof Error ? e.message : "error"),
    onState: (s) => states.push(s),
    delayMs: 1000,
  });
  return { saver, states, saved, set: (v: string) => { value = v; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Autosaver", () => {
  it("debounces: many touches, one save after the quiet period", async () => {
    const { saver, saved, states } = make();
    saver.touch(); await vi.advanceTimersByTimeAsync(500);
    saver.touch(); await vi.advanceTimersByTimeAsync(500);
    expect(saved).toEqual([]); // still within the window of the second touch
    expect(states.at(-1)?.status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(600);
    expect(saved).toEqual(["v1"]);
    expect(states.map((s) => s.status)).toEqual(["dirty", "saving", "saved"]);
  });

  it("does not save an unchanged scene twice", async () => {
    const { saver, saved } = make();
    saver.touch(); await vi.advanceTimersByTimeAsync(1100);
    saver.touch(); await vi.advanceTimersByTimeAsync(1100);
    expect(saved).toEqual(["v1"]);
    expect(saver.current.status).toBe("saved");
  });

  it("reports failure with the message, then retries successfully", async () => {
    let fail = true;
    const { saver, states, saved } = make({ save: async (v) => { if (fail) throw new Error("network down"); saved.push(v); } });
    saver.touch(); await vi.advanceTimersByTimeAsync(1100);
    expect(saver.current).toEqual({ status: "failed", error: "network down" });
    fail = false;
    await saver.retry();
    expect(saver.current.status).toBe("saved");
    expect(states.map((s) => s.status)).toContain("failed");
  });

  it("a change made during a save is saved right after it", async () => {
    let release!: () => void;
    const saved: string[] = [];
    const { saver, set } = make({ save: (v) => new Promise<void>((res) => { release = () => { saved.push(v); res(); }; }) });
    saver.touch(); await vi.advanceTimersByTimeAsync(1100);
    expect(saver.current.status).toBe("saving");
    set("v2"); saver.touch();
    release(); await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(1100);
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(saved).toEqual(["v1", "v2"]);
  });

  it("a conflict stops autosave until it is resolved", async () => {
    let conflict = true;
    const saved: string[] = [];
    const { saver, set } = make({ save: async (v) => { if (conflict) throw new Conflict("changed elsewhere"); saved.push(v); } });
    saver.touch(); await vi.advanceTimersByTimeAsync(1100);
    expect(saver.current).toEqual({ status: "conflict", error: "changed elsewhere" });
    set("v2"); saver.touch(); await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toEqual([]); // no silent overwrite
    conflict = false;
    await saver.resolveConflict(true); // keep mine
    expect(saved).toEqual(["v2"]);
    expect(saver.current.status).toBe("saved");
  });

  it("discarding local changes after a conflict returns to idle without saving", async () => {
    const saved: string[] = [];
    const { saver } = make({ save: async () => { throw new Conflict("x"); } });
    saver.touch(); await vi.advanceTimersByTimeAsync(1100);
    await saver.resolveConflict(false);
    expect(saver.current.status).toBe("idle");
    expect(saved).toEqual([]);
  });

  it("flush saves immediately; dispose cancels pending work", async () => {
    const { saver, saved } = make();
    saver.touch(); await saver.flush();
    expect(saved).toEqual(["v1"]);
    const second = make();
    second.saver.touch(); second.saver.dispose(); await vi.advanceTimersByTimeAsync(5000);
    expect(second.saved).toEqual([]);
  });

  it("hasUnsaved reflects dirty, saving, failed and conflict", async () => {
    const { saver } = make();
    expect(saver.hasUnsaved).toBe(false);
    saver.touch(); expect(saver.hasUnsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(1100);
    expect(saver.hasUnsaved).toBe(false);
  });
});
