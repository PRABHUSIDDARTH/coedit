import { expect, test } from "vitest";
import * as Y from "yjs";
import { cellKey, SheetEngine } from "./formula";
import { bindSheet, writeCell } from "./sheet";

/** A simulated client: its own Y.Doc and formula engine, wired like the real grid. */
function client() {
  const doc = new Y.Doc();
  const cells = doc.getMap<string>("cells");
  const engine = new SheetEngine();
  let renders = 0;
  const unbind = bindSheet(cells, engine, () => renders++);
  return { doc, cells, engine, unbind, renders: () => renders };
}

type Client = ReturnType<typeof client>;

/** Deliver every client's missing updates to every other client (full mesh, any order). */
function syncAll(clients: Client[]) {
  for (const from of clients)
    for (const to of clients)
      if (from !== to) Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc, Y.encodeStateVector(to.doc)));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const view = (c: Client) =>
  JSON.stringify({
    raw: [...c.cells.entries()].sort(([a], [b]) => a.localeCompare(b)),
    shown: c.engine.computedRows(),
  });

test("an edit on one client recalculates formulas on the other", () => {
  const [a, b] = [client(), client()];
  writeCell(a.cells, "A1", "2");
  writeCell(a.cells, "A2", "3");
  writeCell(b.cells, "A3", "=SUM(A1:A2)");
  syncAll([a, b]);
  expect(a.engine.display("A3")).toBe("5");
  expect(b.engine.display("A3")).toBe("5");

  writeCell(b.cells, "A1", "10");
  syncAll([a, b]);
  expect(a.engine.display("A3")).toBe("13");
  expect(a.renders()).toBeGreaterThan(0);
});

test("content that existed before binding is loaded", () => {
  const doc = new Y.Doc();
  const cells = doc.getMap<string>("cells");
  cells.set("B2", "4");
  cells.set("B3", "=B2*B2");
  const engine = new SheetEngine();
  bindSheet(cells, engine, () => {});
  expect(engine.display("B3")).toBe("16");
});

test("clearing a cell removes the key for everyone", () => {
  const [a, b] = [client(), client()];
  writeCell(a.cells, "A1", "5");
  syncAll([a, b]);
  writeCell(b.cells, "A1", "");
  syncAll([a, b]);
  expect(a.cells.has("A1")).toBe(false);
  expect(a.engine.display("A1")).toBe("");
});

test("after unbinding, remote edits no longer touch the engine", () => {
  const [a, b] = [client(), client()];
  a.unbind();
  writeCell(b.cells, "A1", "5");
  syncAll([a, b]);
  expect(a.cells.get("A1")).toBe("5");
  expect(a.engine.display("A1")).toBe("");
});

test("three clients making random concurrent edits end with identical sheets", () => {
  for (const seed of [1, 2, 3, 20261115]) {
    const rand = mulberry32(seed);
    const clients = [client(), client(), client()];
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const anyCell = () => cellKey(Math.floor(rand() * 4), Math.floor(rand() * 5)); // 20 cells: many collisions
    const inputs = [
      () => String(Math.floor(rand() * 100)),
      () => `=${anyCell()}+${anyCell()}`,
      () => `=SUM(${anyCell()}:${anyCell()})`,
      () => `=AVERAGE(A1:D5)/${anyCell()}`,
      () => "label",
      () => "",
    ];
    for (let round = 0; round < 40; round++) {
      // Everyone edits before anyone hears from the others: genuinely concurrent writes.
      for (const c of clients) {
        const edits = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < edits; i++) writeCell(c.cells, anyCell(), pick(inputs)());
      }
      if (rand() < 0.6) syncAll(rand() < 0.5 ? clients : [...clients].reverse());
    }
    syncAll(clients);
    syncAll(clients);
    const views = clients.map(view);
    expect(new Set(views).size, `seed ${seed}`).toBe(1);
    expect(clients[0].cells.size, `seed ${seed}`).toBeGreaterThan(0);
  }
});
