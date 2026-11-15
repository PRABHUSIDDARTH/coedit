import { useMemo, useRef, useState, type FormEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  canEdit,
  useCreateFile,
  useTreeChange,
  useUpload,
  type FileEntry,
  type FileKind,
  type Tree,
  type TreeChange,
} from "../../api/workspaces";
import { IMPORT_ACCEPT, parseImport } from "../../lib/importFile";
import { setPendingImport } from "../../lib/pendingImport";
import { buildTree, type FolderNode } from "../../lib/tree";

type NewKind = "folder" | "doc" | "sheet";
type Draft =
  | { type: "create"; parentId: string | null; kind: NewKind }
  | { type: "rename"; target: "folder" | "file"; id: string; name: string };

const KIND_ICON: Record<FileKind, string> = { doc: "📄", sheet: "▦", blob: "📎" };
const NEW_LABEL: Record<NewKind, string> = { folder: "Folder", doc: "Doc", sheet: "Sheet" };

function NameForm(props: {
  initial: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  function submit(e: FormEvent) {
    e.preventDefault();
    const name = value.trim();
    if (name) props.onSubmit(name);
    else props.onCancel();
  }
  return (
    <form className="tree-name-form" onSubmit={submit}>
      <input
        autoFocus
        value={value}
        placeholder={props.placeholder}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onBlur={props.onCancel}
        onKeyDown={(e) => e.key === "Escape" && props.onCancel()}
        onFocus={(e) => e.target.select()}
        aria-label={props.placeholder}
      />
    </form>
  );
}

function AddButtons({ onAdd, onUpload }: { onAdd: (kind: NewKind) => void; onUpload: () => void }) {
  return (
    <>
      <button className="icon" title="Upload a file (max 50 MB)" aria-label="Upload a file" onClick={onUpload}>
        ↑File
      </button>
      {(["doc", "sheet", "folder"] as const).map((kind) => (
        <button
          key={kind}
          className="icon"
          title={`New ${NEW_LABEL[kind].toLowerCase()}`}
          aria-label={`New ${NEW_LABEL[kind].toLowerCase()}`}
          onClick={() => onAdd(kind)}
        >
          +{NEW_LABEL[kind]}
        </button>
      ))}
    </>
  );
}

export function FileTree({ workspaceId, tree }: { workspaceId: string; tree: Tree }) {
  const change = useTreeChange(workspaceId);
  const upload = useUpload(workspaceId);
  const picker = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);

  const navigate = useNavigate();
  const createFile = useCreateFile(workspaceId);
  const importPicker = useRef<HTMLInputElement>(null);
  const [importNote, setImportNote] = useState<{ error: boolean; text: string } | null>(null);

  async function importFile(file: File) {
    setImportNote(null);
    try {
      const parsed = await parseImport(file);
      const created = await createFile.mutateAsync({ name: parsed.name, kind: parsed.kind, folder_id: null });
      setPendingImport(created.id, parsed.content);
      if (parsed.warning) setImportNote({ error: false, text: parsed.warning });
      navigate(`/w/${workspaceId}/f/${created.id}`);
    } catch (err) {
      setImportNote({ error: true, text: err instanceof Error ? err.message : "Import failed" });
    }
  }

  function pickUpload(folderId: string | null) {
    uploadTarget.current = folderId;
    if (folderId) toggle(folderId, true);
    picker.current?.click();
  }
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const editable = canEdit(tree.role);
  const root = useMemo(() => buildTree(tree.folders, tree.files), [tree]);

  function run(c: TreeChange) {
    setDraft(null);
    change.mutate(c);
  }

  function toggle(id: string, open?: boolean) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open ?? prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startCreate(parentId: string | null, kind: NewKind) {
    if (parentId) toggle(parentId, true);
    setDraft({ type: "create", parentId, kind });
  }

  function createForm(parentId: string | null, depth: number) {
    if (draft?.type !== "create" || draft.parentId !== parentId) return null;
    const { kind } = draft;
    return (
      <li className="tree-row" style={{ paddingLeft: depth * 14 + 8 }}>
        <span className="tree-icon">{kind === "folder" ? "📁" : KIND_ICON[kind]}</span>
        <NameForm
          initial=""
          placeholder={`${NEW_LABEL[kind]} name`}
          onCancel={() => setDraft(null)}
          onSubmit={(name) =>
            run(
              kind === "folder"
                ? { op: "createFolder", name, parentId }
                : { op: "createFile", name, kind, folderId: parentId },
            )
          }
        />
      </li>
    );
  }

  function fileRow(file: FileEntry, depth: number) {
    const renaming = draft?.type === "rename" && draft.target === "file" && draft.id === file.id;
    return (
      <li key={file.id} className="tree-row" style={{ paddingLeft: depth * 14 + 8 }}>
        <span className="tree-icon">{KIND_ICON[file.kind]}</span>
        {renaming ? (
          <NameForm
            initial={file.name}
            placeholder="File name"
            onCancel={() => setDraft(null)}
            onSubmit={(name) => run({ op: "renameFile", id: file.id, name })}
          />
        ) : (
          <NavLink className="tree-label" to={`/w/${workspaceId}/f/${file.id}`}>
            {file.name}
          </NavLink>
        )}
        {editable && !renaming && (
          <span className="tree-actions">
            <button
              className="icon"
              title="Rename"
              aria-label={`Rename ${file.name}`}
              onClick={() => setDraft({ type: "rename", target: "file", id: file.id, name: file.name })}
            >
              ✎
            </button>
            <button
              className="icon"
              title="Delete"
              aria-label={`Delete ${file.name}`}
              onClick={() => {
                if (window.confirm(`Delete "${file.name}"?`)) run({ op: "deleteFile", id: file.id });
              }}
            >
              ✕
            </button>
          </span>
        )}
      </li>
    );
  }

  function folderRows(folder: FolderNode, depth: number) {
    const open = !collapsed.has(folder.id);
    const renaming = draft?.type === "rename" && draft.target === "folder" && draft.id === folder.id;
    const count = folder.folders.length + folder.files.length;
    return (
      <li key={folder.id}>
        <div className="tree-row" style={{ paddingLeft: depth * 14 + 8 }}>
          <button
            className="icon tree-icon"
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`}
            onClick={() => toggle(folder.id)}
          >
            {open ? "▾" : "▸"}
          </button>
          {renaming ? (
            <NameForm
              initial={folder.name}
              placeholder="Folder name"
              onCancel={() => setDraft(null)}
              onSubmit={(name) => run({ op: "renameFolder", id: folder.id, name })}
            />
          ) : (
            <span className="tree-label folder" onClick={() => toggle(folder.id)}>
              {folder.name}
            </span>
          )}
          {editable && !renaming && (
            <span className="tree-actions">
              <AddButtons onAdd={(kind) => startCreate(folder.id, kind)} onUpload={() => pickUpload(folder.id)} />
              <button
                className="icon"
                title="Rename"
                aria-label={`Rename ${folder.name}`}
                onClick={() =>
                  setDraft({ type: "rename", target: "folder", id: folder.id, name: folder.name })
                }
              >
                ✎
              </button>
              <button
                className="icon"
                title="Delete"
                aria-label={`Delete ${folder.name}`}
                onClick={() => {
                  const what = count ? ` and the ${count} item(s) inside it` : "";
                  if (window.confirm(`Delete folder "${folder.name}"${what}?`))
                    run({ op: "deleteFolder", id: folder.id });
                }}
              >
                ✕
              </button>
            </span>
          )}
        </div>
        {open && (
          <ul>
            {createForm(folder.id, depth + 1)}
            {folder.folders.map((f) => folderRows(f, depth + 1))}
            {folder.files.map((f) => fileRow(f, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  const empty = root.folders.length === 0 && root.files.length === 0 && !draft;
  return (
    <nav className="tree" aria-label="Files">
      <div className="tree-head">
        <span>Files</span>
        {editable && (
          <span className="tree-head-actions">
            <AddButtons onAdd={(kind) => startCreate(null, kind)} onUpload={() => pickUpload(null)} />
            <button
              className="icon"
              title="Import a .md file as a doc or a .csv file as a sheet"
              aria-label="Import .md or .csv"
              onClick={() => importPicker.current?.click()}
            >
              ⇪Import
            </button>
          </span>
        )}
      </div>
      <input
        ref={picker}
        type="file"
        hidden
        aria-label="File to upload"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) upload.mutate({ file: chosen, folderId: uploadTarget.current });
          e.target.value = "";
        }}
      />
      <input
        ref={importPicker}
        type="file"
        hidden
        accept={IMPORT_ACCEPT}
        aria-label="File to import"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) void importFile(chosen);
          e.target.value = "";
        }}
      />
      {importNote && (
        <p className={`${importNote.error ? "error" : "muted"} tree-error`} role={importNote.error ? "alert" : "status"}>
          {importNote.text}
        </p>
      )}
      {upload.isPending && <p className="muted tree-error">Uploading…</p>}
      {(change.isError || upload.isError) && (
        <p className="error tree-error" role="alert">
          {(upload.error ?? change.error)?.message}
        </p>
      )}
      <ul>
        {createForm(null, 0)}
        {root.folders.map((f) => folderRows(f, 0))}
        {root.files.map((f) => fileRow(f, 0))}
      </ul>
      {empty && (
        <p className="muted tree-empty">
          {editable ? "Nothing here yet. Create a doc, sheet or folder above." : "Nothing here yet."}
        </p>
      )}
    </nav>
  );
}
