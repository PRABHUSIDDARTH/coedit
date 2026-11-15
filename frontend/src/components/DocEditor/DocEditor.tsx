import { useEffect, useState, type FormEvent } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { CollabSession } from "../../lib/collab";
import { downloadText, withExtension } from "../../lib/download";
import { htmlToMarkdown } from "../../lib/markdown";
import { takePendingImport } from "../../lib/pendingImport";
import "./DocEditor.css";

function Toolbar({ editor, readOnly, onExport }: { editor: Editor; readOnly: boolean; onExport: () => void }) {
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  // Re-render the toolbar when the selection or marks change.
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      code: e.isActive("code"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      codeBlock: e.isActive("codeBlock"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  const chain = () => editor.chain().focus();
  const buttons: [label: string, title: string, on: boolean, run: () => void][] = [
    ["H1", "Heading 1", active.h1, () => chain().toggleHeading({ level: 1 }).run()],
    ["H2", "Heading 2", active.h2, () => chain().toggleHeading({ level: 2 }).run()],
    ["B", "Bold", active.bold, () => chain().toggleBold().run()],
    ["I", "Italic", active.italic, () => chain().toggleItalic().run()],
    ["• List", "Bullet list", active.bullet, () => chain().toggleBulletList().run()],
    ["1. List", "Numbered list", active.ordered, () => chain().toggleOrderedList().run()],
    ["</>", "Inline code", active.code, () => chain().toggleCode().run()],
    ["{ }", "Code block", active.codeBlock, () => chain().toggleCodeBlock().run()],
  ];

  function applyLink(e: FormEvent) {
    e.preventDefault();
    const href = (linkDraft ?? "").trim();
    if (href) chain().extendMarkRange("link").setLink({ href }).run();
    else chain().extendMarkRange("link").unsetLink().run();
    setLinkDraft(null);
  }

  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
      {!readOnly && buttons.map(([label, title, on, run]) => (
        <button key={title} type="button" title={title} aria-label={title} aria-pressed={on} onClick={run}>
          {label}
        </button>
      ))}
      {!readOnly && (
        <>
          <button
            type="button"
            title="Link"
            aria-pressed={active.link}
            onClick={() => setLinkDraft(linkDraft === null ? active.href : null)}
          >
            Link
          </button>
          <button type="button" title="Undo" aria-label="Undo" onClick={() => chain().undo().run()}>
            ↶
          </button>
          <button type="button" title="Redo" aria-label="Redo" onClick={() => chain().redo().run()}>
            ↷
          </button>
        </>
      )}
      <span className="spacer" />
      <button type="button" title="Download this document as Markdown" onClick={onExport}>
        Export .md
      </button>
      {linkDraft !== null && (
        <form className="doc-link-form" onSubmit={applyLink}>
          <input
            autoFocus
            type="url"
            value={linkDraft}
            placeholder="https://… (empty removes the link)"
            aria-label="Link address"
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLinkDraft(null)}
          />
          <button type="submit">Apply</button>
        </form>
      )}
    </div>
  );
}

export function DocEditor({ session, name }: { session: CollabSession; name: string }) {
  const editor = useEditor(
    {
      editable: !session.readOnly,
      extensions: [
        // History comes from Yjs (per-user undo), so the built-in one must be off.
        StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
        Collaboration.configure({ document: session.doc }),
        CollaborationCaret.configure({ provider: session.provider, user: session.user }),
      ],
      editorProps: { attributes: { class: "doc-page", "aria-label": "Document" } },
    },
    [session],
  );

  // A just-imported .md file: write its content into the (new, empty) shared document once.
  useEffect(() => {
    if (!editor || session.readOnly) return;
    const imported = takePendingImport(session.fileId, "doc");
    if (imported) editor.commands.setContent(imported.html);
  }, [editor, session]);

  if (!editor) return null;
  return (
    <div className="doc-editor">
      <Toolbar
        editor={editor}
        readOnly={session.readOnly}
        onExport={() =>
          downloadText(withExtension(name, ".md"), `${htmlToMarkdown(editor.getHTML())}\n`, "text/markdown")
        }
      />
      <EditorContent editor={editor} className="doc-scroll" />
    </div>
  );
}
