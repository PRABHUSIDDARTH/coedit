import { describe, expect, test } from "vitest";
import { cellKey, COLS, columnName, parseKey, ROWS, SheetEngine } from "./formula";

function sheet(cells: Record<string, string>) {
  const engine = new SheetEngine();
  engine.load(Object.entries(cells));
  return engine;
}

describe("gate", () => {
  test("SUM over a range, recalculated when an input changes", () => {
    const s = sheet({ A1: "2", A2: "3", A3: "=SUM(A1:A2)" });
    expect(s.display("A3")).toBe("5");
    s.set("A1", "10");
    expect(s.display("A3")).toBe("13");
  });

  test("AVERAGE", () => {
    const s = sheet({ A1: "2", A2: "3", A3: "7", B1: "=AVERAGE(A1:A3)" });
    expect(s.display("B1")).toBe("4");
    s.set("A3", "10");
    expect(s.display("B1")).toBe("5");
  });

  test("+ - * / with cell references and precedence", () => {
    const s = sheet({ A1: "8", A2: "2" });
    const cases: Record<string, string> = {
      "=A1+A2": "10",
      "=A1-A2": "6",
      "=A1*A2": "16",
      "=A1/A2": "4",
      "=A1+A2*3": "14",
      "=(A1+A2)*3": "30",
      "=-A1+1": "-7",
      "=A1/A2/2": "2",
      "=2*3.5": "7",
    };
    for (const [formula, expected] of Object.entries(cases)) {
      s.set("C1", formula);
      expect(s.display("C1"), formula).toBe(expected);
    }
  });
});

describe("values", () => {
  test("plain numbers, text and empty cells", () => {
    const s = sheet({ A1: "42", A2: "hello", A3: " 3.50 ", A4: "-0.5", A5: "1e3" });
    expect(s.display("A1")).toBe("42");
    expect(s.display("A2")).toBe("hello");
    expect(s.display("A3")).toBe("3.5");
    expect(s.display("A4")).toBe("-0.5");
    expect(s.display("A5")).toBe("1000");
    expect(s.display("B9")).toBe("");
    expect(s.raw("A3")).toBe(" 3.50 ");
    expect(s.raw("B9")).toBe("");
  });

  test("things that only look like numbers stay text", () => {
    const s = sheet({ A1: "12/05/2026", A2: "50%", A3: "TRUE", A4: "1,000", A5: "'quoted", A6: "007x" });
    for (const key of ["A1", "A2", "A3", "A4", "A5", "A6"]) expect(s.display(key)).toBe(s.raw(key));
  });

  test("no floating-point noise in results", () => {
    const s = sheet({ A1: "0.1", A2: "0.2", A3: "=A1+A2", A4: "=1/3" });
    expect(s.display("A3")).toBe("0.3");
    expect(s.display("A4")).toBe("0.3333333333");
  });

  test("empty cells count as 0 in arithmetic and are skipped by AVERAGE", () => {
    const s = sheet({ A1: "4", B1: "=A1+Z99", B2: "=AVERAGE(A1:A5)", B3: "=SUM(C1:C5)" });
    expect(s.display("B1")).toBe("4");
    expect(s.display("B2")).toBe("4");
    expect(s.display("B3")).toBe("0");
  });

  test("formulas can reference text and other formulas", () => {
    const s = sheet({ A1: "note", A2: "=A1", B1: "2", B2: "=B1*2", B3: "=B2*2", B4: "=SUM(B1:B3)" });
    expect(s.display("A2")).toBe("note");
    expect(s.display("B4")).toBe("14");
    s.set("B1", "3");
    expect(s.display("B4")).toBe("21");
  });

  test("function names and references are case-insensitive", () => {
    const s = sheet({ A1: "2", A2: "3", A3: "=sum(a1:a2)" });
    expect(s.display("A3")).toBe("5");
  });
});

describe("errors", () => {
  test("division by zero, cycles, bad names and syntax show spreadsheet errors", () => {
    const s = sheet({ A1: "=1/0", B1: "=B2", B2: "=B1", C1: "=NOPE(1)", D1: "=SUM(", E1: '="a"*2' });
    expect(s.display("A1")).toBe("#DIV/0!");
    expect(s.display("B1")).toBe("#CYCLE!");
    expect(s.display("C1")).toBe("#NAME?");
    expect(s.display("D1")).toBe("#ERROR!");
    expect(s.display("E1")).toBe("#VALUE!");
  });

  test("errors propagate and clear once the cause is fixed", () => {
    const s = sheet({ A1: "0", A2: "=10/A1", A3: "=A2+1" });
    expect(s.display("A3")).toBe("#DIV/0!");
    s.set("A1", "5");
    expect(s.display("A3")).toBe("3");
  });

  test("a self-reference does not break the rest of the sheet", () => {
    const s = sheet({ A1: "=A1", B1: "1", B2: "=B1+1" });
    expect(s.display("A1")).toBe("#CYCLE!");
    expect(s.display("B2")).toBe("2");
  });
});

describe("editing", () => {
  test("clearing a cell updates dependants", () => {
    const s = sheet({ A1: "2", A2: "3", A3: "=SUM(A1:A2)" });
    s.set("A2", undefined);
    expect(s.display("A3")).toBe("2");
    expect(s.raw("A2")).toBe("");
    s.set("A1", "");
    expect(s.display("A3")).toBe("0");
  });

  test("replacing a formula with a value and back", () => {
    const s = sheet({ A1: "=1+1" });
    s.set("A1", "9");
    expect(s.display("A1")).toBe("9");
    s.set("A1", "=A2");
    expect(s.display("A1")).toBe("");
  });

  test("keys outside the 26 x 100 grid are ignored", () => {
    const s = sheet({ AA1: "5", A101: "5", A0: "5", "": "5", a1: "7", "A1:B2": "5" });
    expect(s.display("A1")).toBe("");
    expect(s.set("AA1", "1")).toBe(false);
    expect(s.set("Z100", "1")).toBe(true);
    expect(s.display("Z100")).toBe("1");
  });

  test("computed rows are trimmed to the used area", () => {
    const s = sheet({ A1: "x", C2: "=1+1" });
    expect(s.computedRows()).toEqual([
      ["x", "", ""],
      ["", "", "2"],
    ]);
    expect(new SheetEngine().computedRows()).toEqual([]);
  });
});

describe("keys", () => {
  test("column names and key round trip", () => {
    expect([columnName(0), columnName(25)]).toEqual(["A", "Z"]);
    expect(cellKey(0, 0)).toBe("A1");
    expect(cellKey(25, 99)).toBe("Z100");
    expect(parseKey("C12")).toEqual({ col: 2, row: 11 });
    expect(parseKey("Z100")).toEqual({ col: COLS - 1, row: ROWS - 1 });
    for (const bad of ["AA1", "A101", "A0", "a1", "1A", "A", "A01", "A1 "]) expect(parseKey(bad)).toBeNull();
  });
});
