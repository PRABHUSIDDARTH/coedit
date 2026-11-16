import { describe, expect, it } from "vitest";
import { canvasMode, exportFileName, findUnsupported, pickAppState, sanitizeLink, sanitizeLoadedScene, sceneFromEditor, sceneSignature } from "./canvas";

const el = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "rectangle", x: 0, y: 0, version: 1, ...extra });

describe("sanitizeLink", () => {
  it.each(["http://example.com", "https://example.com/a?b=c#d", "HTTPS://EXAMPLE.COM", "mailto:someone@example.com"])("keeps %s", (l) => {
    expect(sanitizeLink(l)).toBe(l);
  });
  it.each([
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "  javascript:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)",
    "jav&#x09;ascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd", "ftp://example.com/x",
    "blob:https://example.com/x", "//example.com/x", "example.com", "https://", "mailto:", "x".repeat(3000), "",
  ])("drops %j", (l) => {
    expect(sanitizeLink(l)).toBeNull();
  });
  it("drops non-strings", () => {
    for (const v of [null, undefined, 5, true, ["https://example.com"], { a: 1 }]) expect(sanitizeLink(v)).toBeNull();
  });
});

describe("sceneFromEditor", () => {
  it("keeps live elements, drops deleted ones and sanitises links", () => {
    const scene = sceneFromEditor(
      [el("a", { link: "javascript:alert(1)" }), el("b", { link: "https://example.com" }), el("c", { isDeleted: true }), el("d")],
      { viewBackgroundColor: "#112233" },
    );
    expect(scene.elements.map((e) => [e.id, e.link])).toEqual([["a", null], ["b", "https://example.com"], ["d", undefined]]);
  });
  it("persists background and grid only, never collaborators or transient state", () => {
    const state = pickAppState({
      viewBackgroundColor: "#abc", gridSize: 20, gridModeEnabled: true,
      collaborators: new Map([["u", {}]]), selectedElementIds: { a: true }, scrollX: 3, zoom: { value: 2 }, openMenu: "x",
    } as never);
    expect(state).toEqual({ viewBackgroundColor: "#abc", gridSize: 20, gridModeEnabled: true });
    expect(Object.keys(state).sort()).toEqual(["gridModeEnabled", "gridSize", "viewBackgroundColor"]);
  });
  it("falls back to safe defaults for bad appState values", () => {
    expect(pickAppState({ viewBackgroundColor: "url(javascript:x)", gridSize: 0, gridModeEnabled: "yes" } as never))
      .toEqual({ viewBackgroundColor: "#ffffff", gridSize: null, gridModeEnabled: false });
    expect(pickAppState(null)).toEqual({ viewBackgroundColor: "#ffffff", gridSize: null, gridModeEnabled: false });
  });
});

describe("images and unknown types", () => {
  it("findUnsupported reports images/embeds but ignores deleted ones", () => {
    expect(findUnsupported([el("a"), { ...el("b"), type: "image" }])).toBe("image");
    expect(findUnsupported([el("a"), { ...el("b"), type: "embeddable" }])).toBe("embeddable");
    expect(findUnsupported([el("a"), { ...el("b"), type: "image", isDeleted: true }])).toBeNull();
    expect(findUnsupported([])).toBeNull();
  });
});

describe("sanitizeLoadedScene", () => {
  it("cleans a scene from the server: no unsafe links, no unknown types, no junk", () => {
    const s = sanitizeLoadedScene({ elements: [el("a", { link: "data:text/html,x" }), { id: "i", type: "image" }, null, { type: "rectangle" }], appState: { scrollX: 1 }, junk: 1 });
    expect(s.elements.map((e) => e.id)).toEqual(["a"]);
    expect(s.elements[0].link).toBeNull();
    expect(Object.keys(s)).toEqual(["elements", "appState"]);
  });
  it("tolerates garbage", () => {
    for (const v of [null, undefined, 5, "x", [], { elements: "no" }]) expect(sanitizeLoadedScene(v).elements).toEqual([]);
  });
});

describe("sceneSignature", () => {
  it("changes when an element changes or is deleted, not on selection or scroll", () => {
    const base = sceneSignature([el("a"), el("b")], { viewBackgroundColor: "#fff" });
    expect(sceneSignature([el("a"), el("b")], { viewBackgroundColor: "#fff", scrollX: 99 } as never)).toBe(base);
    expect(sceneSignature([el("a"), el("b", { version: 2 })], { viewBackgroundColor: "#fff" })).not.toBe(base);
    expect(sceneSignature([el("a"), el("b", { isDeleted: true })], { viewBackgroundColor: "#fff" })).not.toBe(base);
    expect(sceneSignature([el("a"), el("b")], { viewBackgroundColor: "#000000" })).not.toBe(base);
  });
});

describe("view-only mode and file names", () => {
  it("only owners and editors can edit; viewers and unknown roles are view-only", () => {
    expect(canvasMode("owner")).toBe("edit");
    expect(canvasMode("editor")).toBe("edit");
    expect(canvasMode("viewer")).toBe("view");
    expect(canvasMode(undefined)).toBe("view");
  });
  it("exportFileName is safe", () => {
    expect(exportFileName("../../etc/passwd", "png")).toBe("_.._etc_passwd.png");
    expect(exportFileName("", "svg")).toBe("canvas.svg");
    expect(exportFileName("My board", "png")).toBe("My board.png");
  });
});
