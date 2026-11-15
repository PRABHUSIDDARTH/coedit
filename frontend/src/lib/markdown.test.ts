import { expect, test } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "./markdown";

const SAMPLE = `# Project plan

Some **bold**, _italic_ and \`code\` with a [link](https://example.com/a).

## Goals

- ship the demo
- keep it small
  - nested point

1. first
2. second

\`\`\`
const x = 1;
\`\`\`
`;

test("md -> html -> md keeps headings, lists, emphasis, links and code", () => {
  const html = markdownToHtml(SAMPLE);
  expect(html).toContain("<h1>Project plan</h1>");
  expect(html).toContain("<h2>Goals</h2>");
  expect(html).toContain("<ul>");
  expect(html).toContain("<ol>");

  const md = htmlToMarkdown(html);
  expect(md).toContain("# Project plan");
  expect(md).toContain("## Goals");
  expect(md).toMatch(/^- ship the demo$/m);
  expect(md).toMatch(/^- keep it small$/m);
  expect(md).toMatch(/^ {2,4}- nested point$/m);
  expect(md).toMatch(/^1\. first$/m);
  expect(md).toMatch(/^2\. second$/m);
  expect(md).toContain("**bold**");
  expect(md).toContain("_italic_");
  expect(md).toContain("`code`");
  expect(md).toContain("[link](https://example.com/a)");
  expect(md).toContain("```\nconst x = 1;\n```");
});

test("a second round trip is stable", () => {
  const once = htmlToMarkdown(markdownToHtml(SAMPLE));
  expect(htmlToMarkdown(markdownToHtml(once))).toBe(once);
});

test("raw HTML in an imported file is shown as text, never turned into elements", () => {
  const html = markdownToHtml('Hi <script>alert(1)</script> <img src=x onerror="alert(2)">\n\n<iframe src="//evil"></iframe>');
  expect(html).not.toMatch(/<script|<img|<iframe/i);
  expect(html).toContain("&lt;script&gt;");
});

test("javascript: links are not made clickable", () => {
  expect(markdownToHtml("[x](javascript:alert(1))")).not.toContain("href");
});

test("empty input", () => {
  expect(markdownToHtml("")).toBe("");
  expect(htmlToMarkdown("")).toBe("");
});
