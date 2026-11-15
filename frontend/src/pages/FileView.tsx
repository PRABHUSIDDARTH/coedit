import type { FileEntry } from "../api/workspaces";
import { CollabStatusBar } from "../components/CollabStatusBar";
import { DocEditor } from "../components/DocEditor/DocEditor";
import { SheetGrid } from "../components/SheetGrid/SheetGrid";
import { useCollab } from "../lib/collab";

/** A doc or sheet with its live session. Keyed by file id in the parent, so state never leaks between files. */
export function FileView({ file }: { file: FileEntry }) {
  const collab = useCollab(file.id);
  const { session, synced, error } = collab;

  return (
    <section className="file-view">
      <header className="file-head">
        <h2>{file.name}</h2>
        <CollabStatusBar collab={collab} />
      </header>
      {error && (
        <p className="error file-msg" role="alert">
          {error}
        </p>
      )}
      {!error && !(session && synced) && <p className="muted file-msg">Opening…</p>}
      {/* Mount the editor only after the first sync, so nobody types into a doc that hasn't loaded. */}
      {session && synced && file.kind === "doc" && <DocEditor session={session} name={file.name} />}
      {session && synced && file.kind === "sheet" && <SheetGrid session={session} name={file.name} />}
    </section>
  );
}
