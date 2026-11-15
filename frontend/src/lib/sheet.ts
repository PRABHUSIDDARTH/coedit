import type * as Y from "yjs";
import type { SheetEngine } from "./formula";

/** Write one cell's raw input to the shared map; empty input removes the key. */
export function writeCell(cells: Y.Map<string>, key: string, raw: string): void {
  if (raw.trim() === "") {
    if (cells.has(key)) cells.delete(key);
  } else if (cells.get(key) !== raw) {
    cells.set(key, raw);
  }
}

/**
 * Keep a formula engine in step with the shared `cells` map: load what is there, then apply
 * every local or remote change. `onChange` fires after each batch. Returns an unbind function.
 */
export function bindSheet(cells: Y.Map<string>, engine: SheetEngine, onChange: () => void): () => void {
  engine.load(cells.entries());
  const observer = (event: Y.YMapEvent<string>) => {
    engine.load([...event.keysChanged].map((key) => [key, cells.get(key)] as const));
    onChange();
  };
  cells.observe(observer);
  return () => cells.unobserve(observer);
}
