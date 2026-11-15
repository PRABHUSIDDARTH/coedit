"use client";

import { Table } from "@tiptap/extension-table";
import { TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Code, Code2, Heading1, Heading2, Italic, List, ListOrdered, MessageSquarePlus, Quote, Sparkles, Strikethrough, Table2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useCollab } from "@/hooks/use-collab";
import type { DocUpdate } from "@/lib/collab/types";
import type { DocData } from "@/lib/data/types";
import { answerToHtml, esc, plain } from "@/lib/format";
import { cn, timeAgo } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { Comment, RemoteCarets, SlashCommand, setRemoteCarets, type RemoteCaret } from "./extensions";
import { SlashMenu } from "./slash-menu";
import "./editor.css";

const ME = { id: "u-priya", name: "Priya Nair", seat: 1 };

function Tool({ label, active, onClick, children, disabled }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle size="sm" pressed={!!active} onPressedChange={onClick} aria-label={label} disabled={disabled} className="size-7 min-w-7 px-0">{children}</Toggle>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function DocEditor({ docId, doc }: { docId: string; doc: DocData }) {
  const router = useRouter();
  const setCouncilSeed = useUi((s) => s.setCouncilSeed);
  const pending = useUi((s) => s.pendingInsert);
  const setPending = useUi((s) => s.setPendingInsert);
  const [comments, setComments] = useState(doc.comments);
  const [draft, setDraft] = useState("");
  const [commentOpen, setCommentOpen] = useState(false);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  const collab = useCollab(docId, "doc", (u: DocUpdate) => {
    const ed = editorRef.current;
    const p = u.payload as { op?: string; text?: string; author?: string };
    if (!ed || p.op !== "append-paragraph" || !p.text) return;
    ed.chain().insertContentAt(ed.state.doc.content.size, `<p><strong>${esc(p.author ?? "")}:</strong> ${esc(p.text)}</p>`).run();
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      Placeholder.configure({ placeholder: "Write something, or type / for blocks" }),
      Comment, RemoteCarets, SlashCommand,
    ],
    content: doc.html,
    editorProps: { attributes: { class: "doc-prose", role: "textbox", "aria-multiline": "true", "aria-label": `${doc.title}, document` } },
  });
  useEffect(() => { editorRef.current = editor; });

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => e ? {
      bold: e.isActive("bold"), italic: e.isActive("italic"), strike: e.isActive("strike"), code: e.isActive("code"),
      h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }),
      ul: e.isActive("bulletList"), ol: e.isActive("orderedList"), quote: e.isActive("blockquote"), pre: e.isActive("codeBlock"),
      hasSelection: !e.state.selection.empty,
    } : null,
  });

  // Mock presence -> carets in the document.
  const carets = useMemo<RemoteCaret[]>(() => collab.peers.flatMap((p) =>
    p.position?.kind === "doc" ? [{ id: p.collaborator.id, name: p.collaborator.name, seat: p.collaborator.seat, pos: p.position.pos, typing: p.typing }] : []), [collab.peers]);
  useEffect(() => { if (editor) setRemoteCarets(editor, carets); }, [editor, carets]);

  usePageMeta({ title: doc.title, kind: "doc", peers: [ME, ...collab.peers.map((p) => p.collaborator)] });

  // "Insert into doc" from the council page.
  useEffect(() => {
    if (!editor || !pending || pending.docId !== docId) return;
    editor.chain().focus("end").insertContent(answerToHtml(pending.text)).run();
    toast.success("Inserted the Council answer");
    setPending(null);
  }, [editor, pending, docId, setPending]);

  if (!editor || !state) return <div className="animate-pulse page-x py-16" aria-busy="true" aria-label="Loading editor"><div className="h-8 w-2/3 rounded bg-raised" /><div className="mt-6 h-4 w-full rounded bg-raised" /><div className="mt-3 h-4 w-5/6 rounded bg-raised" /></div>;

  const askCouncil = () => {
    const { from, to } = editor.state.selection;
    const text = from !== to ? editor.state.doc.textBetween(from, to, " ") : plain(editor.getHTML()).slice(0, 600);
    setCouncilSeed(text);
    router.push("/app/council");
  };

  const addComment = () => {
    if (!draft.trim()) return;
    const id = `c-${Date.now().toString(36)}`;
    editor.chain().focus().setComment(id).run();
    setComments((c) => [...c, { id, author: ME.name, seat: ME.seat, text: draft.trim(), editedAt: new Date().toISOString() }]);
    setDraft(""); setCommentOpen(false);
    toast.success("Comment added");
  };

  const live = collab.state === "connected";
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 border-b border-border bg-background px-3 py-1.5">
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
          <Button size="sm" variant="outline" onClick={askCouncil} className="ml-1"><Sparkles className="text-azure" /> Ask Council</Button>
          <span className="ml-auto flex items-center gap-1.5 pr-1 text-xs text-ink-3" role="status">
            <span aria-hidden className={cn("size-1.5 rounded-full", live ? "bg-success" : "bg-warning")} />
            {live ? "Live" : collab.state === "connecting" ? "Connecting…" : "Offline"}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto"><div className="page-x py-10"><EditorContent editor={editor} /></div></div>
      </div>

      <aside aria-label="Comments" className="hidden w-72 shrink-0 overflow-y-auto border-l border-border bg-raised p-4 xl:block">
        <h2 className="mb-3 text-xs font-medium text-ink-3">Comments</h2>
        {comments.length === 0 && <p className="text-sm text-ink-3">No comments yet. Select text and choose Comment.</p>}
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-panel p-3">
              <div className="flex items-center gap-2"><SeatAvatar name={c.author} seat={c.seat} size={20} /><span className="text-sm font-medium text-ink">{c.author}</span><span className="ml-auto text-xs text-ink-3">{timeAgo(c.editedAt)}</span></div>
              <p className="mt-2 text-sm text-ink-2">{c.text}</p>
            </li>
          ))}
        </ul>
      </aside>
      <SlashMenu />
    </div>
  );
}
