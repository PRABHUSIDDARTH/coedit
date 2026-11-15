import { expect, test } from "vitest";
import { withExtension } from "./download";
import { parseImport } from "./importFile";
import { setPendingImport, takePendingImport } from "./pendingImport";

const file = (name: string, text: string) => new File([text], name);

test("a .md file becomes doc HTML named after the file", async () => {
  const parsed = await parseImport(file("Plan v2.md", "# Title\n\n- a\n"));
  expect(parsed).toMatchObject({ name: "Plan v2", kind: "doc", warning: null });
  expect(parsed.content).toEqual({ kind: "doc", html: "<h1>Title</h1>\n<ul>\n<li>a</li>\n</ul>" });
});

test("a .csv file becomes sheet cells, with a warning when it does not fit", async () => {
  const parsed = await parseImport(file("data.CSV", "a,b\n1,=A2*2\n"));
  expect(parsed.kind).toBe("sheet");
  expect(parsed.content).toEqual({ kind: "sheet", cells: [["A1", "a"], ["B1", "b"], ["A2", "1"], ["B2", "=A2*2"]] });
  const big = await parseImport(file("big.csv", Array.from({ length: 101 }, (_, i) => `${i}`).join("\n")));
  expect(big.warning).toMatch(/100 rows/);
});

test("other file types are refused with a pointer to upload", async () => {
  await expect(parseImport(file("page.html", "<b>x</b>"))).rejects.toThrow(/Only \.md and \.csv/);
  await expect(parseImport(file("noextension", "x"))).rejects.toThrow();
});

test("pending content is handed over exactly once and only to the right editor", () => {
  setPendingImport("f1", { kind: "doc", html: "<p>x</p>" });
  expect(takePendingImport("f1", "sheet")).toBeNull();
  expect(takePendingImport("other", "doc")).toBeNull();
  expect(takePendingImport("f1", "doc")).toEqual({ kind: "doc", html: "<p>x</p>" });
  expect(takePendingImport("f1", "doc")).toBeNull();
});

test("export file names", () => {
  expect(withExtension("Budget", ".csv")).toBe("Budget.csv");
  expect(withExtension("notes.MD", ".md")).toBe("notes.MD");
  expect(withExtension("a/b:c", ".md")).toBe("a_b_c.md");
  expect(withExtension("  ", ".md")).toBe("untitled.md");
});
