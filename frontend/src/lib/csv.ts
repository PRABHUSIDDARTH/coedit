import Papa from "papaparse";
import { cellKey, COLS, parseKey, ROWS } from "./formula";

/** Pick the delimiter that occurs most often outside quotes on the first line (comma wins ties). */
function guessDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

/** Parse CSV text into rows of strings (comma, semicolon or tab; BOM ignored). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  if (clean.trim() === "") return [];
  const { data } = Papa.parse<string[]>(clean, { skipEmptyLines: false, delimiter: guessDelimiter(clean) });
  // A trailing newline yields one final empty row; drop it but keep blank rows in between.
  while (data.length > 0 && data[data.length - 1].every((cell) => cell === "")) data.pop();
  return data.map((row) => row.map((cell) => String(cell ?? "")));
}

/** Rows -> sheet cells ("A1" -> raw). Anything outside the 26 x 100 grid is dropped. */
export function csvToCells(rows: string[][]): { cells: [string, string][]; truncated: boolean } {
  const cells: [string, string][] = [];
  let truncated = rows.length > ROWS;
  rows.slice(0, ROWS).forEach((row, r) => {
    if (row.length > COLS && row.slice(COLS).some((cell) => cell !== "")) truncated = true;
    row.slice(0, COLS).forEach((value, c) => {
      if (value !== "") cells.push([cellKey(c, r), value]);
    });
  });
  return { cells, truncated };
}

/** Sheet cells -> rows, trimmed to the used rectangle (raw values, gaps as ""). */
export function cellsToRows(cells: Iterable<readonly [string, string]>): string[][] {
  const rows: string[][] = [];
  let width = 0;
  for (const [key, value] of cells) {
    const at = parseKey(key);
    if (!at) continue;
    while (rows.length <= at.row) rows.push([]);
    rows[at.row][at.col] = value;
    width = Math.max(width, at.col + 1);
  }
  return rows.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? ""));
}

export function rowsToCsv(rows: string[][]): string {
  return Papa.unparse(rows, { newline: "\r\n" });
}
