import { Extension, Mark, mergeAttributes, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";

/* ---------- Comment mark ---------- */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: { setComment: (id: string) => ReturnType; unsetComment: () => ReturnType };
  }
}

export const Comment = Mark.create({
  name: "comment",
  inclusive: false,
  addAttributes() {
    return { id: { default: null, parseHTML: (el) => el.getAttribute("data-comment"), renderHTML: (a) => (a.id ? { "data-comment": a.id } : {}) } };
  },
  parseHTML() { return [{ tag: "mark[data-comment]" }]; },
  renderHTML({ HTMLAttributes }) { return ["mark", mergeAttributes(HTMLAttributes), 0]; },
  addCommands() {
    return {
      setComment: (id) => ({ commands }) => commands.setMark(this.name, { id }),
      unsetComment: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
});

/* ---------- Slash menu ---------- */
export interface SlashItem { title: string; hint: string; run: (editor: Editor, range: Range) => void }

export const SLASH_ITEMS: SlashItem[] = [
  { title: "Heading 1", hint: "Large section title", run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run() },
  { title: "Heading 2", hint: "Section title", run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run() },
  { title: "Bulleted list", hint: "A simple list", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: "Numbered list", hint: "A list with order", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: "Table", hint: "3 by 3 with a header row", run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: "Code block", hint: "Monospaced snippet", run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { title: "Quote", hint: "Call out a line", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
];

export interface SlashState { open: boolean; items: SlashItem[]; index: number; rect: DOMRect | null; pick: (i: SlashItem) => void }
let slash: SlashState = { open: false, items: [], index: 0, rect: null, pick: () => {} };
const listeners = new Set<() => void>();
const set = (s: Partial<SlashState>) => { slash = { ...slash, ...s }; listeners.forEach((l) => l()); };
export const slashStore = { subscribe: (l: () => void) => (listeners.add(l), () => { listeners.delete(l); }), get: () => slash };

export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        allowSpaces: false,
        items: ({ query }) => SLASH_ITEMS.filter((i) => i.title.toLowerCase().includes(query.toLowerCase())),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => ({
          onStart: (p: SuggestionProps<SlashItem, SlashItem>) => set({ open: true, items: p.items, index: 0, rect: p.clientRect?.() ?? null, pick: (i) => p.command(i) }),
          onUpdate: (p) => set({ items: p.items, index: 0, rect: p.clientRect?.() ?? null, pick: (i) => p.command(i) }),
          onKeyDown: ({ event }: SuggestionKeyDownProps) => {
            if (!slash.open || slash.items.length === 0) return false;
            if (event.key === "ArrowDown") { set({ index: (slash.index + 1) % slash.items.length }); return true; }
            if (event.key === "ArrowUp") { set({ index: (slash.index - 1 + slash.items.length) % slash.items.length }); return true; }
            if (event.key === "Enter") { slash.pick(slash.items[slash.index]); return true; }
            if (event.key === "Escape") { set({ open: false }); return true; }
            return false;
          },
          onExit: () => set({ open: false }),
        }),
      }),
    ];
  },
});
