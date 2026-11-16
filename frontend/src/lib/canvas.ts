/** Canvas scene helpers: what is saved, what is refused, and the link rules.
 *  Mirrors backend/app/services/canvas.py; the server is the authority, this keeps bad data out of
 *  the editor and out of the request in the first place. */

export const MAX_SCENE_BYTES = 5 * 1024 * 1024;
/** Element types we save. Images are out of scope for v1 (they need file storage). */
export const SAVED_TYPES = new Set(["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "frame"]);
const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const MAX_LINK = 2048;
const CONTROL = /[\x00-\x20\x7f-\x9f]/;

export interface SceneAppState { viewBackgroundColor: string; gridSize: number | null; gridModeEnabled: boolean }
export type SceneElement = Record<string, unknown> & { id: string; type: string };
export interface Scene { elements: SceneElement[]; appState: SceneAppState }

export const EMPTY_SCENE: Scene = { elements: [], appState: { viewBackgroundColor: "#ffffff", gridSize: null, gridModeEnabled: false } };

/** The link if it is a short http, https or mailto URL, else null. Control characters and spaces are
 *  refused (browsers ignore tabs and newlines inside a scheme, so "java\tscript:" must not pass). */
export function sanitizeLink(link: unknown): string | null {
  if (typeof link !== "string" || !link || link.length > MAX_LINK || CONTROL.test(link)) return null;
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  if (!LINK_SCHEMES.has(url.protocol)) return null;
  if (url.protocol === "mailto:") return url.pathname ? link : null;
  return url.host ? link : null;
}

type EditorElement = { id: string; type: string; isDeleted?: boolean; link?: unknown; version?: number } & Record<string, unknown>;
type EditorAppState = { viewBackgroundColor?: unknown; gridSize?: unknown; gridModeEnabled?: unknown } & Record<string, unknown>;

const COLOR = /^(#[0-9a-fA-F]{3,8}|transparent)$/;

/** Only background colour and grid are persisted; never collaborators, selection, scroll or other transient state. */
export function pickAppState(state: EditorAppState | null | undefined): SceneAppState {
  const color = typeof state?.viewBackgroundColor === "string" && COLOR.test(state.viewBackgroundColor) ? state.viewBackgroundColor : EMPTY_SCENE.appState.viewBackgroundColor;
  const g = state?.gridSize;
  const gridSize = typeof g === "number" && Number.isInteger(g) && g >= 1 && g <= 1000 ? g : null;
  return { viewBackgroundColor: color, gridSize, gridModeEnabled: state?.gridModeEnabled === true };
}

/** First element type the scene cannot hold (images, embeds), or null. Deleted elements do not count. */
export function findUnsupported(elements: readonly EditorElement[]): string | null {
  for (const el of elements) if (!el.isDeleted && !SAVED_TYPES.has(el.type)) return el.type;
  return null;
}

/** The scene to save: live elements only, links sanitised, appState reduced. */
export function sceneFromEditor(elements: readonly EditorElement[], appState: EditorAppState | null | undefined): Scene {
  const live: SceneElement[] = [];
  for (const el of elements) {
    if (el.isDeleted) continue;
    const copy: SceneElement = { ...el } as SceneElement;
    if ("link" in copy) copy.link = sanitizeLink(copy.link);
    live.push(copy);
  }
  return { elements: live, appState: pickAppState(appState) };
}

/** Defence in depth for a scene that came from the server: never hand unsanitised links or unknown types to the editor. */
export function sanitizeLoadedScene(raw: unknown): Scene {
  const obj = (raw && typeof raw === "object" ? raw : {}) as { elements?: unknown; appState?: EditorAppState };
  const elements = Array.isArray(obj.elements) ? (obj.elements as EditorElement[]).filter((e) => e && typeof e === "object" && typeof e.id === "string" && SAVED_TYPES.has(e.type)) : [];
  return sceneFromEditor(elements, obj.appState);
}

/** Cheap change signature, so pointer moves and selection changes do not look like edits.
 *  Every Excalidraw element carries a `version` that goes up on each change. */
export function sceneSignature(elements: readonly EditorElement[], appState: EditorAppState | null | undefined): string {
  let sum = 0;
  for (const el of elements) sum += (typeof el.version === "number" ? el.version : 0) + (el.isDeleted ? 1 : 0);
  const a = pickAppState(appState);
  return `${elements.length}:${sum}:${a.viewBackgroundColor}:${a.gridSize}:${a.gridModeEnabled}`;
}

export const sceneBytes = (scene: Scene): number => new TextEncoder().encode(JSON.stringify(scene)).length;

/** Safe download name: no path characters, never empty. */
export function exportFileName(name: string, ext: "png" | "svg"): string {
  const base = name.replace(/[^A-Za-z0-9 _.-]+/g, "_").replace(/^\.+/, "").trim().slice(0, 80) || "canvas";
  return `${base}.${ext}`;
}

export type CanvasMode = "edit" | "view";
/** Viewers (and anyone whose role is unknown) get view-only mode. The API enforces this too. */
export const canvasMode = (role: "owner" | "editor" | "viewer" | undefined): CanvasMode => (role === "owner" || role === "editor" ? "edit" : "view");
