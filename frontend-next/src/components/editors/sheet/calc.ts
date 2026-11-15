import { HyperFormula } from "hyperformula";
import type { ColumnType } from "@/lib/data/types";

export const colLetter = (i: number): string => {
  let s = ""; let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
};
export const address = (row: number, col: number) => `${colLetter(col)}${row + 1}`;

const toHF = (raw: string): string | number | null => {
  if (raw === "") return null;
  if (raw.startsWith("=")) return raw;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
};

/** Wraps HyperFormula. Raw strings are the source of truth; formulas start with "=". */
export class Calc {
  private hf: HyperFormula;
  constructor(rows: string[][]) {
    this.hf = HyperFormula.buildFromArray(rows.map((r) => r.map(toHF)), { licenseKey: "gpl-v3" });
  }
  set(row: number, col: number, raw: string) {
    this.hf.setCellContents({ sheet: 0, row, col }, [[toHF(raw)]]);
  }
  addRow(width: number) {
    const n = this.hf.getSheetDimensions(0).height;
    this.hf.addRows(0, [n, 1]);
    this.hf.setCellContents({ sheet: 0, row: n, col: 0 }, [Array.from({ length: width }, () => null)]);
  }
  /** Computed value, or an error code like "#DIV/0!". */
  value(row: number, col: number): string | number | boolean | null {
    const v = this.hf.getCellValue({ sheet: 0, row, col });
    if (v !== null && typeof v === "object") return (v as { value: string }).value;
    return v as string | number | boolean | null;
  }
  destroy() { this.hf.destroy(); }
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function display(v: string | number | boolean | null, type: ColumnType): string {
  if (v === null || v === "") return "";
  if (typeof v === "string" && v.startsWith("#")) return v; // error code
  if (typeof v === "number") {
    if (type === "currency") return money.format(v);
    if (type === "percent") return `${num.format(v * 100)}%`;
    return num.format(v);
  }
  if (type === "date" && typeof v === "string") {
    const d = new Date(v);
    return isNaN(+d) ? v : d.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
  }
  return String(v);
}

export const isNumeric = (t: ColumnType) => t === "number" || t === "currency" || t === "percent";

/** Status values map onto the status hues. Unknown values read as neutral. */
export const STATUS_TONE: Record<string, "success" | "info" | "warning" | "danger"> = {
  Growing: "success", Stable: "info", "At risk": "warning", Open: "info", Interviewing: "warning", Offer: "success", Blocked: "danger",
};
