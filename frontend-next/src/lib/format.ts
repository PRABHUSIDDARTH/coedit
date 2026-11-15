const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Turns a council answer (plain paragraphs and "- " bullets) into editor HTML. */
export function answerToHtml(text: string): string {
  return text.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    const bullets = lines.filter((l) => l.startsWith("- "));
    if (bullets.length === lines.length) return `<ul>${bullets.map((b) => `<li><p>${esc(b.slice(2))}</p></li>`).join("")}</ul>`;
    const [head, ...rest] = lines;
    const m = /^([A-Z][^:\n]{2,40}):\s*(.*)$/.exec(head);
    const first = m ? `<strong>${esc(m[1])}:</strong> ${esc(m[2])}` : esc(head);
    const list = rest.filter((l) => l.startsWith("- "));
    return `<p>${first}</p>${list.length ? `<ul>${list.map((b) => `<li><p>${esc(b.slice(2))}</p></li>`).join("")}</ul>` : ""}`;
  }).join("");
}

export const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
export { esc };
