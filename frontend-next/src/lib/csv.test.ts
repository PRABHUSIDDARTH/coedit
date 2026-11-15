import { expect, test } from "vitest";
import { cellsToRows, csvToCells, parseCsv, rowsToCsv } from "./csv";
import { SheetEngine } from "./formula";

test("parse -> cells -> export round-trips, including quotes, commas and newlines", () => {
  const csv = 'name,qty,note\r\nwidget,2,"said ""hi"", twice"\r\n"multi\nline",3.5,\r\n';
  const rows = parseCsv(csv);
  expect(rows).toEqual([
    ["name", "qty", "note"],
    ["widget", "2", 'said "hi", twice'],
    ["multi\nline", "3.5", ""],
  ]);
  const { cells, truncated } = csvToCells(rows);
  expect(truncated).toBe(false);
  expect(Object.fromEntries(cells)).toEqual({
    A1: "name", B1: "qty", C1: "note",
    A2: "widget", B2: "2", C2: 'said "hi", twice',
    A3: "multi\nline", B3: "3.5",
  });
  expect(parseCsv(rowsToCsv(cellsToRows(cells)))).toEqual(rows);
});

test("export writes computed values, not formulas", () => {
  const engine = new SheetEngine();
  engine.load(csvToCells(parseCsv("2,3\n=SUM(A1:B1),=A1/0\n")).cells);
  expect(rowsToCsv(engine.computedRows())).toBe("2,3\r\n5,#DIV/0!");
});

test("empty cells are skipped and gaps are kept in place", () => {
  const { cells } = csvToCells(parseCsv("a,,c\n\n,,z\n"));
  expect(Object.fromEntries(cells)).toEqual({ A1: "a", C1: "c", C3: "z" });
  expect(cellsToRows(cells)).toEqual([
    ["a", "", "c"],
    ["", "", ""],
    ["", "", "z"],
  ]);
});

test("content beyond 26 columns or 100 rows is dropped and reported", () => {
  const wide = csvToCells([Array.from({ length: 30 }, (_, i) => `c${i}`)]);
  expect(wide.cells).toHaveLength(26);
  expect(wide.truncated).toBe(true);
  const tall = csvToCells(Array.from({ length: 120 }, (_, i) => [`r${i}`]));
  expect(tall.cells).toHaveLength(100);
  expect(tall.cells.at(-1)).toEqual(["A100", "r99"]);
  expect(tall.truncated).toBe(true);
});

test("semicolon-delimited files and a UTF-8 BOM are handled", () => {
  expect(parseCsv("\uFEFFa;b\n1;2\n")).toEqual([
    ["a", "b"],
    ["1", "2"],
  ]);
  expect(parseCsv("")).toEqual([]);
});
