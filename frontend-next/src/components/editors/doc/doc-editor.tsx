"use client";

import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Code2, Download, Eye, Heading1, Heading2, Italic, List, ListOrdered, MessageSquarePlus, Quote, Sparkles, Strikethrough, Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type * as Y from "yjs";
import { useMe } from "@/api/auth";
import type { FileEntry } from "@/api/workspaces";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePageMeta } from "@/hooks/use-page-meta";
import { usePeers } from "@/lib/collab/awareness";
import { useCollab, type CollabSession } from "@/lib/collab/session";
import { downloadText, withExtension } from "@/lib/download";
import { plain } from "@/lib/format";
import { htmlToMarkdown } from "@/lib/markdown";
import { takePendingImport } from "@/lib/pendingImport";
import { seatForUser } from "@/lib/seats";
import { cn, timeAgo } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { Comment, SlashCommand } from "./extensions";
import { SlashMenu } from "./slash-menu";
import "./editor.css";

interface CommentItem { id: string; author: string; authorId: string; text: string; at: string }

const INACTIVE = { bold: false, italic: false, strike: false, code: false, h1: false, h2: false, ul: false, ol: false, quote: false, pre: false, hasSelection: false };

function Tool({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild><Toggle size="sm" pressed={!!active} onPressedChange={onClick} aria-label={label} className="size-7 min-w-7 px-0">{children}</Toggle></TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Comments live in the same Yjs document as the text, so they sync and persist with it. */
function useComments(doc: Y.Doc) {
  const arr = doc.getArray<CommentItem>("comments");
  const list = useSyncExternalStore(
    (cb) => { arr.observe(cb); return () => arr.unobserve(cb); },
    () => arr.toJSON().length + ":" + arr.toJSON().map((c: CommentItem) => c.id).join(","),
    () => "",
  );
  void list; // re-render trigger only
  return { items: arr.toJSON() as CommentItem[], add: (c: CommentItem) => arr.push([c]) };
}

function Surface({ session, file, synced, status }: { session: CollabSession; file: FileEntry; synced: boolean; status: string }) {
  const router = useRouter();
  const me = useMe().data!;
  const setCouncilSeed = useUi((s) => s.setCouncilSeed);
  const seat = seatForUser(me.id);
  const peers = usePeers(session.provider);
  const comments = useComments(session.doc);
  const [draft, setDraft] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !session.readOnly,
    extensions: [
      StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] } }), // history comes from Yjs
      Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      Placeholder.configure({ placeholder: "Write something, or type / for blocks" }),
      Comment, SlashCommand,
      Collaboration.configure({ document: session.doc, field: "default" }),
      CollaborationCaret.configure({
        provider: session.provider,
        user: { id: me.id, name: me.display_name, color: `var(--seat-${seat})` },
        render: (u: { name: string; color: string }) => {
          const caret = document.createElement("span"); caret.className = "remote-caret"; caret.style.setProperty("--c", u.color);
          const label = document.createElement("span"); label.className = "remote-caret__label"; label.textContent = u.name.split(" ")[0];
          caret.appendChild(label); return caret;
        },
      }),
    ],
    editorProps: { attributes: { class: "doc-prose", role: "textbox", "aria-multiline": "true", "aria-label": `${file.name}, document` } },
  }, [session]);

  // TipTap's useEditorState stays null until the first transaction, so it must never gate rendering.
  const toolbar = useEditorState({
    editor,
    selector: ({ editor: e }) => e ? {
      bold: e.isActive("bold"), italic: e.isActive("italic"), strike: e.isActive("strike"), code: e.isActive("code"),
      h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }),
      ul: e.isActive("bulletList"), ol: e.isActive("orderedList"), quote: e.isActive("blockquote"), pre: e.isActive("codeBlock"),
      hasSelection: !e.state.selection.empty,
    } : null,
  });

  // A file made by "Import" is filled once, by whoever opens it first, after the stored (empty) state arrives.
  useEffect(() => {
    if (!editor || !synced || session.readOnly || !editor.isEmpty) return;
    const pending = takePendingImport(file.id, "doc");
    if (pending) editor.commands.setContent(pending.html);
  }, [editor, synced, session.readOnly, file.id]);

  usePageMeta({ title: file.name, kind: "doc", peers: [{ id: me.id, name: me.display_name, seat }, ...peers] });

  const state = toolbar ?? INACTIVE;

  if (!editor) return <div className="animate-pulse page-x py-16" aria-busy="true" aria-label="Loading editor"><div className="h-8 w-2/3 rounded bg-raised" /><div className="mt-6 h-4 w-full rounded bg-raised" /></div>;

  const askCouncil = () => {
    const { from, to } = editor.state.selection;
    setCouncilSeed(from !== to ? editor.state.doc.textBetween(from, to, " ") : plain(editor.getHTML()).slice(0, 600));
    router.push("/app/council");
  };
  const addComment = () => {
    if (!draft.trim()) return;
    const id = `c-${Date.now().toString(36)}`;
    editor.chain().focus().setComment(id).run();
    comments.add({ id, author: me.display_name, authorId: me.id, text: draft.trim(), at: new Date().toISOString() });
    setDraft(""); setCommentOpen(false); toast.success("Comment added");
  };
  const live = status === "connected";

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-border bg-background px-3 py-1.5">
          {!session.readOnly && (<>
            <Tool label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></Tool>
            <Tool label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></Tool>
            <Tool label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></Tool>
            <Tool label="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}><Code /></Tool>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Tool label="Heading 1" active={state.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 /></Tool>
            <Tool label="Heading 2" active={state.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></Tool>
            <Tool label="Bulleted list" active={state.ul} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></Tool>
            <Tool label="Numbered list" active={state.ol} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></Tool>
            <Tool label="Quote" active={state.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></Tool>
            <Tool label="Code block" active={state.pre} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><Code2 /></Tool>
            <Tool label="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 /></Tool>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Popover open={commentOpen} onOpenChange={setCommentOpen}>
              <PopoverTrigger asChild><Button variant="ghost" size="sm" disabled={!state.hasSelection} title={state.hasSelection ? "Comment on the selected text" : "Select text to comment on it"}><MessageSquarePlus /> Comment</Button></PopoverTrigger>
              <PopoverContent align="start" className="w-72 space-y-2">
                <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a comment" aria-label="Comment" rows={3} />
                <div className="flex justify-end"><Button size="sm" onClick={addComment} disabled={!draft.trim()}>Add comment</Button></div>
              </PopoverContent>
            </Popover>
          </>)}
          {session.readOnly && <span className="flex items-center gap-1.5 px-2 text-xs text-ink-2"><Eye className="size-3.5" aria-hidden /> View only</span>}
          <Button size="sm" variant="outline" onClick={askCouncil} className="ml-1"><Sparkles className="text-azure" /> Ask Council</Button>
          <Button size="sm" variant="ghost" onClick={() => downloadText(withExtension(file.name, ".md"), htmlToMarkdown(editor.getHTML()), "text/markdown")}><Download /> Export .md</Button>
          <span className="ml-auto flex items-center gap-1.5 pr-1 text-xs text-ink-3" role="status">
            <span aria-hidden className={cn("size-1.5 rounded-full", live && synced ? "bg-success" : "bg-warning")} />
            {live ? (synced ? "Live" : "Loading…") : status === "connecting" ? "Connecting…" : "Offline, changes will sync when you reconnect"}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto"><div className="page-x py-10"><EditorContent editor={editor} /></div></div>
      </div>

      <aside aria-label="Comments" className="hidden w-72 shrink-0 overflow-y-auto border-l border-border bg-raised p-4 xl:block">
        <h2 className="mb-3 text-xs font-medium text-ink-3">Comments</h2>
        {comments.items.length === 0 && <p className="text-sm text-ink-3">{session.readOnly ? "No comments yet." : "No comments yet. Select text and choose Comment."}</p>}
        <ul className="space-y-3">
          {comments.items.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-panel p-3">
              <div className="flex items-center gap-2"><SeatAvatar name={c.author} seat={seatForUser(c.authorId)} size={20} /><span className="text-sm font-medium text-ink">{c.author}</span><span className="ml-auto text-xs text-ink-3">{timeAgo(c.at)}</span></div>
              <p className="mt-2 text-sm text-ink-2">{c.text}</p>
            </li>
          ))}
        </ul>
      </aside>
      <SlashMenu />
    </div>
  );
}

export default function DocEditor({ file }: { file: FileEntry }) {
  const collab = useCollab(file.id);
  usePageMeta(collab.session ? undefined : { title: file.name, kind: "doc", peers: [] });
  if (collab.error) return <ErrorState title="This document didn't open" error={new Error(collab.error)} onRetry={() => location.reload()} />;
  if (!collab.session) return <div className="animate-pulse page-x py-16" aria-busy="true" aria-label="Opening document"><div className="h-9 w-2/3 rounded bg-raised" /><div className="mt-8 space-y-3"><div className="h-4 rounded bg-raised" /><div className="h-4 w-11/12 rounded bg-raised" /></div></div>;
  return <Surface key={collab.session.fileId} session={collab.session} file={file} synced={collab.synced} status={collab.status} />;
}
