/** Save generated text as a file from the browser. */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Save a Blob (e.g. a PNG or SVG export) as a file from the browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** "Budget" + ".csv" -> "Budget.csv"; "notes.md" + ".md" stays "notes.md". */
export function withExtension(name: string, extension: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
  return safe.toLowerCase().endsWith(extension) ? safe : `${safe}${extension}`;
}
