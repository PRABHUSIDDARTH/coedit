import { DetailedCellError, HyperFormula } from "hyperformula";

export const COLS = 26;
export const ROWS = 100;

const KEY = /^([A-Z])([1-9]\d{0,2})$/;
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

export const columnName = (col: number) => String.fromCharCode(65 + col);
export const cellKey = (col: number, row: number) => `${columnName(col)}${row + 1}`;

/** "C12" -> {col: 2, row: 11}; null for anything outside the 26 x 100 grid. */
export function parseKey(key: string): { col: number; row: number } | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const row = Number(m[2]) - 1;
  return row < ROWS ? { col: m[1].charCodeAt(0) - 65, row } : null;
}

/** What HyperFormula should store for a raw cell input. */
function toContent(raw: string): string | number | null {
  const text = raw.trim();
  if (text === "") return null;
  if (text.startsWith("=")) return text;
  if (NUMBER.test(text)) return Number(text);
  // Everything else is text. The apostrophe stops HyperFormula from reading "50%", "TRUE"
  // or "12/05/2026" as a number, boolean or date.
  return `'${raw}`;
}

/**
 * One sheet of raw inputs plus their computed values. Raw strings are the source of truth
 * (they are what is synced between users); HyperFormula only evaluates them.
 */
export class SheetEngine {
  private readonly hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
  private readonly sheet: number;
  private readonly inputs = new Map<string, string>();

  constructor() {
    this.sheet = this.hf.getSheetId(this.hf.addSheet("Sheet1")) as number;
  }

  /** Set (or clear, with undefined/empty) one cell. Returns false for keys outside the grid. */
  set(key: string, raw: string | undefined): boolean {
    const at = parseKey(key);
    if (!at) return false;
    const value = typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
    if (value === undefined) this.inputs.delete(key);
    else this.inputs.set(key, value);
    this.hf.setCellContents({ sheet: this.sheet, ...at }, [[value === undefined ? null : toContent(value)]]);
    return true;
  }

  load(entries: Iterable<readonly [string, string | undefined]>): void {
    this.hf.batch(() => {
      for (const [key, raw] of entries) this.set(key, raw);
    });
  }

  /** The input exactly as typed ("" when empty). */
  raw(key: string): string {
    return this.inputs.get(key) ?? "";
  }

  /** The value to show in the grid: computed result, error code, or "". */
  display(key: string): string {
    const at = parseKey(key);
    if (!at) return "";
    const value = this.hf.getCellValue({ sheet: this.sheet, ...at });
    if (value === null || value === undefined) return "";
    if (value instanceof DetailedCellError) return value.value;
    if (typeof value === "number") return String(Number(value.toPrecision(10)));
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    return String(value);
  }

  /** Computed values as rows, trimmed to the used rectangle (for CSV export). */
  computedRows(): string[][] {
    let maxCol = -1;
    let maxRow = -1;
    for (const key of this.inputs.keys()) {
      const at = parseKey(key);
      if (!at) continue;
      maxCol = Math.max(maxCol, at.col);
      maxRow = Math.max(maxRow, at.row);
    }
    const rows: string[][] = [];
    for (let r = 0; r <= maxRow; r++) {
      const row: string[] = [];
      for (let c = 0; c <= maxCol; c++) row.push(this.display(cellKey(c, r)));
      rows.push(row);
    }
    return rows;
  }

  destroy(): void {
    this.hf.destroy();
  }
}
