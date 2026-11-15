/**
 * Hand-off for imports. Importing creates an empty doc/sheet through the API, then the editor
 * that opens it writes the content into the shared document (import runs client-side). The content waits here, keyed by file id, and is taken exactly once.
 */
export type PendingImport = { kind: "doc"; html: string } | { kind: "sheet"; cells: [string, string][] };

const pending = new Map<string, PendingImport>();

export function setPendingImport(fileId: string, content: PendingImport): void {
  pending.set(fileId, content);
}

export function takePendingImport<K extends PendingImport["kind"]>(
  fileId: string,
  kind: K,
): Extract<PendingImport, { kind: K }> | null {
  const content = pending.get(fileId);
  if (!content || content.kind !== kind) return null;
  pending.delete(fileId);
  return content as Extract<PendingImport, { kind: K }>;
}
