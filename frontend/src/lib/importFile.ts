import { csvToCells, parseCsv } from "./csv";
import { markdownToHtml } from "./markdown";
import type { PendingImport } from "./pendingImport";

export const IMPORT_ACCEPT = ".md,.markdown,.csv";
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export interface ParsedImport {
  name: string;
  kind: "doc" | "sheet";
  content: PendingImport;
  /** Set when part of the file could not be imported. */
  warning: string | null;
}

/** Turn a picked .md or .csv file into content for a new Doc or Sheet. Throws a user-facing Error. */
export async function parseImport(file: File): Promise<ParsedImport> {
  const match = /^(.*)\.(md|markdown|csv)$/i.exec(file.name);
  if (!match) throw new Error("Only .md and .csv files can be imported. Use ↑File to store other files.");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("That file is too large to import (limit 2 MB).");
  const name = match[1].trim() || "Imported";
  const text = await file.text();
  if (match[2].toLowerCase() === "csv") {
    const { cells, truncated } = csvToCells(parseCsv(text));
    return {
      name,
      kind: "sheet",
      content: { kind: "sheet", cells },
      warning: truncated ? "The file is larger than 26 columns × 100 rows; the rest was left out." : null,
    };
  }
  return { name, kind: "doc", content: { kind: "doc", html: markdownToHtml(text) }, warning: null };
}
