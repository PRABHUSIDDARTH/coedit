import type { ColumnType } from "@/api/sheetTypes";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

export const isNumeric = (t: ColumnType) => t === "number" || t === "currency" || t === "percent";

/** Format a computed value (what SheetEngine.display returns) for a column type. Display only: the raw input is never changed. */
export function formatCell(value: string, type: ColumnType): string {
  if (value === "" || value.startsWith("#")) return value; // empty or an error code
  if (isNumeric(type) && /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(value)) {
    const n = Number(value);
    if (type === "currency") return money.format(n);
    if (type === "percent") return `${num.format(n * 100)}%`;
    return num.format(n);
  }
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T00:00:00`);
    return isNaN(+d) ? value : d.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
  }
  return value;
}

/** Status values map onto the status hues. Unknown values read as neutral info. */
export const STATUS_TONE: Record<string, "success" | "info" | "warning" | "danger"> = {
  Done: "success", Growing: "success", Offer: "success", Stable: "info", Open: "info", "In progress": "warning", Interviewing: "warning", "At risk": "warning", Blocked: "danger",
};
