"use client";

import { ChevronRight, File as FileIcon, FileText, Folder, FolderOpen, FolderPlus, MoreHorizontal, Plus, Table2, Upload, FileUp } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { canEdit, useCreateFile, useTreeChange, useUpload, type FileEntry, type FileKind, type Tree } from "@/api/workspaces";
import { ConfirmDialog, NameDialog } from "@/components/app/dialogs";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IMPORT_ACCEPT, parseImport } from "@/lib/importFile";
import { setPendingImport } from "@/lib/pendingImport";
import { buildTree, type FolderNode } from "@/lib/tree";
import { cn } from "@/lib/utils";

export const fileHref = (f: Pick<FileEntry, "id" | "kind">) => `/app/${f.kind === "blob" ? "file" : f.kind}/${f.id}`;
export const KIND_ICON: Record<FileKind, React.ElementType> = { doc: FileText, sheet: Table2, blob: FileIcon };

type Dialog =
  | { type: "name"; title: string; label: string; initial?: string; confirm: string; submit: (name: string) => void }
  | { type: "confirm"; title: string; body: string; confirm: string; submit: () => void };

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong");

/** Everything that creates, renames, deletes, uploads or imports, shared by the "+" menu and folder menus. */
export function useFileActions(workspaceId: string, tree: Tree | undefined, onNavigate?: () => void) {
  const router = useRouter();
  const change = useTreeChange(workspaceId);
  const createFile = useCreateFile(workspaceId);
  const upload = useUpload(workspaceId);
  const uploadInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const editable = canEdit(tree?.role);
  const go = (href: string) => { onNavigate?.(); router.push(href); };
  const done = () => setDialog(null);

  const actions = {
    editable,
    newFile: (kind: "doc" | "sheet", folderId: string | null) => setDialog({
      type: "name", title: kind === "doc" ? "New doc" : "New sheet", label: "Name", initial: kind === "doc" ? "Untitled doc" : "Untitled sheet", confirm: "Create",
      submit: (name) => { done(); createFile.mutate({ name, kind, folder_id: folderId }, { onSuccess: (f) => go(fileHref(f)), onError: (e) => toast.error(message(e)) }); },
    }),
    newFolder: (parentId: string | null) => setDialog({
      type: "name", title: "New folder", label: "Name", initial: "New folder", confirm: "Create",
      submit: (name) => { done(); change.mutate({ op: "createFolder", name, parentId }, { onError: (e) => toast.error(message(e)) }); },
    }),
    rename: (kind: "file" | "folder", id: string, current: string) => setDialog({
      type: "name", title: `Rename ${kind}`, label: "Name", initial: current, confirm: "Rename",
      submit: (name) => { done(); change.mutate(kind === "file" ? { op: "renameFile", id, name } : { op: "renameFolder", id, name }, { onError: (e) => toast.error(message(e)) }); },
    }),
    remove: (kind: "file" | "folder", id: string, name: string, afterDelete?: () => void) => setDialog({
      type: "confirm", title: `Delete “${name}”?`, confirm: "Delete",
      body: kind === "folder" ? "The folder and everything in it will be deleted for everyone." : "It will be deleted for everyone in this workspace.",
      submit: () => { done(); change.mutate(kind === "file" ? { op: "deleteFile", id } : { op: "deleteFolder", id }, { onSuccess: () => { toast.success("Deleted"); afterDelete?.(); }, onError: (e) => toast.error(message(e)) }); },
    }),
    pickUpload: (folderId: string | null) => { target.current = folderId; uploadInput.current?.click(); },
    pickImport: (folderId: string | null) => { target.current = folderId; importInput.current?.click(); },
  };

  const inputs = (
    <>
      <input ref={uploadInput} type="file" hidden aria-label="Upload a file" onChange={(e) => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (file) upload.mutate({ file, folderId: target.current }, { onSuccess: (f) => { toast.success(`Uploaded ${f.name}`); go(fileHref(f)); }, onError: (err) => toast.error(message(err)) });
      }} />
      <input ref={importInput} type="file" hidden accept={IMPORT_ACCEPT} aria-label="Import a Markdown or CSV file" onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (!file) return;
        try {
          const parsed = await parseImport(file);
          const created = await createFile.mutateAsync({ name: parsed.name, kind: parsed.kind, folder_id: target.current });
          setPendingImport(created.id, parsed.content);
          if (parsed.warning) toast.warning(parsed.warning);
          go(fileHref(created));
        } catch (err) { toast.error(message(err)); }
      }} />
      {dialog?.type === "name" && <NameDialog title={dialog.title} label={dialog.label} initial={dialog.initial} confirm={dialog.confirm} onSubmit={dialog.submit} onClose={done} />}
      {dialog?.type === "confirm" && <ConfirmDialog title={dialog.title} body={dialog.body} confirm={dialog.confirm} onConfirm={dialog.submit} onClose={done} />}
    </>
  );
  return { actions, inputs };
}

type Actions = ReturnType<typeof useFileActions>["actions"];

export function NewMenu({ actions, folderId = null, trigger }: { actions: Actions; folderId?: string | null; trigger: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onSelect={() => actions.newFile("doc", folderId)}><FileText /> New doc</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.newFile("sheet", folderId)}><Table2 /> New sheet</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.newFolder(folderId)}><FolderPlus /> New folder</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.pickUpload(folderId)}><Upload /> Upload a file</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.pickImport(folderId)}><FileUp /> Import .md or .csv</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row({ depth, active, children, menu }: { depth: number; active?: boolean; children: React.ReactNode; menu?: React.ReactNode }) {
  return (
    <div className={cn("group/row flex h-8 items-center rounded-md pr-1 text-sm transition-colors", active ? "bg-panel font-medium text-ink shadow-xs ring-1 ring-border" : "text-ink-2 hover:bg-panel/70 hover:text-ink")} style={{ paddingLeft: 6 + depth * 14 }}>
      {children}
      {menu}
    </div>
  );
}

function ItemMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" aria-label={label} className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FileTree({ tree, actions, onNavigate }: { tree: Tree; actions: Actions; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const root = buildTree(tree.folders, tree.files);
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const file = (f: FileEntry, depth: number) => {
    const Icon = KIND_ICON[f.kind]; const href = fileHref(f); const active = pathname === href;
    return (
      <Row key={f.id} depth={depth} active={active} menu={actions.editable && (
        <ItemMenu label={`Actions for ${f.name}`}>
          <DropdownMenuItem onSelect={() => actions.rename("file", f.id, f.name)}>Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => actions.remove("file", f.id, f.name, () => { if (active) router.push("/app"); })}>Delete</DropdownMenuItem>
        </ItemMenu>
      )}>
        <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className="flex min-w-0 flex-1 items-center gap-2 self-stretch">
          <span className="w-3.5 shrink-0" aria-hidden /><Icon className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{f.name}</span>
        </Link>
      </Row>
    );
  };

  const folder = (n: FolderNode, depth: number): React.ReactNode => {
    const open = !collapsed.has(n.id);
    const Icon = open ? FolderOpen : Folder;
    return (
      <div key={n.id}>
        <Row depth={depth} menu={actions.editable && (
          <ItemMenu label={`Actions for ${n.name}`}>
            <DropdownMenuItem onSelect={() => actions.newFile("doc", n.id)}>New doc here</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.newFile("sheet", n.id)}>New sheet here</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.newFolder(n.id)}>New folder here</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.pickUpload(n.id)}>Upload here</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.rename("folder", n.id, n.name)}>Rename</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => actions.remove("folder", n.id, n.name)}>Delete</DropdownMenuItem>
          </ItemMenu>
        )}>
          <button type="button" onClick={() => toggle(n.id)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left">
            <ChevronRight className={cn("size-3.5 shrink-0 text-ink-3 transition-transform", open && "rotate-90")} aria-hidden /><Icon className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{n.name}</span>
          </button>
        </Row>
        {open && <>{n.folders.map((c) => folder(c, depth + 1))}{n.files.map((f) => file(f, depth + 1))}</>}
      </div>
    );
  };

  if (root.folders.length === 0 && root.files.length === 0) {
    return <p className="px-2 py-1 text-xs text-ink-3">{actions.editable ? "Nothing here yet. Use + to create a doc, sheet or folder." : "Nothing has been shared here yet."}</p>;
  }
  return <div role="tree" aria-label="Files" className="space-y-0.5">{root.folders.map((f) => folder(f, 0))}{root.files.map((f) => file(f, 0))}</div>;
}

export { Plus };
