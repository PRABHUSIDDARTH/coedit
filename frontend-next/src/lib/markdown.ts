import MarkdownIt from "markdown-it";
import TurndownService from "turndown";

// html: false — raw HTML inside an imported .md file is escaped and shown as text.
// markdown-it also refuses javascript:/vbscript:/data: link targets by default.
const md = new MarkdownIt({ html: false, linkify: false });

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  strongDelimiter: "**",
});
// TipTap wraps list item text in <p>; without this every item is followed by a blank line.
turndown.addRule("tightListItem", {
  filter: (node) => node.nodeName === "P" && node.parentNode?.nodeName === "LI",
  replacement: (content) => content,
});

/** Markdown -> HTML for `editor.commands.setContent` (the editor's schema filters it again). */
export function markdownToHtml(markdown: string): string {
  return md.render(markdown).trim();
}

/** Editor HTML -> Markdown. */
export function htmlToMarkdown(html: string): string {
  if (html.trim() === "") return "";
  return turndown
    .turndown(html)
    .replace(/^(\s*)(-|\d+\.) {2,}/gm, "$1$2 ") // turndown pads list markers to 4 columns
    .trim();
}
