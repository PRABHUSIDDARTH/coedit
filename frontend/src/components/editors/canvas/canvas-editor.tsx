"use client";

import { exportToBlob, exportToSvg, Excalidraw, restoreElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, Eye, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchScene, saveScene, useScene, type SceneResponse } from "@/api/canvas";
import { ApiError } from "@/api/client";
import type { FileEntry, Tree } from "@/api/workspaces";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/use-page-meta";
import { Autosaver, type SaveState } from "@/lib/autosave";
import { canvasMode, exportFileName, MAX_SCENE_BYTES, sceneBytes, sceneFromEditor, sceneSignature, SAVED_TYPES, type Scene } from "@/lib/canvas";
import { downloadBlob } from "@/lib/download";

/** The few Excalidraw API calls we use. The full surface is large and versioned. */
interface Api {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
}
type Elements = Parameters<typeof sceneFromEditor>[0];
type AppState = Parameters<typeof sceneFromEditor>[1];

class Blocked extends Error {}

const describe = (e: unknown): string => {
  if (e instanceof Blocked) return e.message;
  if (e instanceof ApiError) {
    if (e.status === 403) return "You no longer have edit access to this canvas.";
    if (e.status === 404) return "This canvas was deleted, or you were removed from the workspace.";
    if (e.status === 409) return "Someone else saved this canvas after you opened it.";
    if (e.status === 413) return "This canvas is too large to save (limit 5 MiB).";
    if (e.status === 422) return e.message;
    return "Could not save. Check your connection.";
  }
  return "Could not save.";
};

function StatusBar({ mode, state, onRetry, onLoadTheirs, onOverwrite, onExport, linksRemoved }: {
  mode: "edit" | "view"; state: SaveState; onRetry: () => void; onLoadTheirs: () => void; onOverwrite: () => void;
  onExport: (kind: "png" | "svg") => void; linksRemoved: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-xs" role="status" aria-live="polite">
      {mode === "view" ? (
        <span className="flex items-center gap-1.5 text-ink-2"><Eye className="size-3.5" aria-hidden /> View only</span>
      ) : state.status === "saving" ? (
        <span className="flex items-center gap-1.5 text-ink-3"><Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…</span>
      ) : state.status === "dirty" ? (
        <span className="text-ink-3">Unsaved changes…</span>
      ) : state.status === "failed" ? (
        <span className="flex items-center gap-2 text-danger"><AlertTriangle className="size-3.5" aria-hidden /> Not saved: {state.error} <Button size="xs" variant="outline" onClick={onRetry}>Retry</Button></span>
      ) : state.status === "conflict" ? (
        <span className="flex flex-wrap items-center gap-2 text-danger"><AlertTriangle className="size-3.5" aria-hidden /> {state.error}
          <Button size="xs" variant="outline" onClick={onLoadTheirs}>Load their version</Button>
          <Button size="xs" variant="outline" onClick={onOverwrite}>Overwrite with mine</Button></span>
      ) : state.status === "saved" ? (
        <span className="flex items-center gap-1.5 text-ink-3"><Check className="size-3.5" aria-hidden /> Saved</span>
      ) : (
        <span className="text-ink-3">Changes save automatically</span>
      )}
      {linksRemoved > 0 && <span className="text-ink-3">{linksRemoved} unsafe link{linksRemoved > 1 ? "s were" : " was"} removed (only http, https and mailto links are kept).</span>}
      <span className="ml-auto flex items-center gap-1">
        <Button size="xs" variant="ghost" onClick={() => onExport("png")}><Download /> PNG</Button>
        <Button size="xs" variant="ghost" onClick={() => onExport("svg")}><Download /> SVG</Button>
      </span>
    </div>
  );
}

function Surface({ file, workspaceId, role, initial, onReload }: {
  file: FileEntry; workspaceId: string; role: Tree["role"] | undefined; initial: SceneResponse; onReload: (fresh: SceneResponse) => void;
}) {
  const { resolvedTheme } = useTheme();
  const qc = useQueryClient();
  const mode = canvasMode(role);
  const [state, setState] = useState<SaveState>({ status: "idle" });
  const [linksRemoved, setLinksRemoved] = useState(0);
  const apiRef = useRef<Api | null>(null);
  const latest = useRef<{ elements: Elements; appState: AppState } | null>(null);
  const revision = useRef(initial.revision);
  const lastSig = useRef<string | null>(null);
  const saverRef = useRef<Autosaver<Scene> | null>(null);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  usePageMeta({ title: file.name, kind: "canvas", peers: [] });

  const initialData = useMemo(() => ({
    elements: restoreElements(initial.scene.elements as never, null),
    appState: { viewBackgroundColor: initial.scene.appState.viewBackgroundColor, gridModeEnabled: initial.scene.appState.gridModeEnabled, gridSize: initial.scene.appState.gridSize ?? 20 },
    scrollToContent: true,
    // Built once per mount: a later refetch must never replace what is being drawn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  useEffect(() => {
    const saver = new Autosaver<Scene>({
      produce: () => {
        const l = latest.current;
        const scene = sceneFromEditor(l?.elements ?? [], l?.appState);
        return { value: scene, key: sceneSignature(l?.elements ?? [], l?.appState) };
      },
      save: async (scene) => {
        if (modeRef.current === "view") throw new Blocked("You no longer have edit access to this canvas.");
        if (scene.elements.some((e) => !SAVED_TYPES.has(e.type))) throw new Blocked("Images and embeds aren't supported in canvases yet. Remove them to save.");
        if (sceneBytes(scene) > MAX_SCENE_BYTES) throw new Blocked("This canvas is too large to save (limit 5 MiB).");
        try {
          const res = await saveScene(file.id, revision.current, scene);
          revision.current = res.revision;
          setLinksRemoved(res.links_removed);
        } catch (e) {
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) void qc.invalidateQueries({ queryKey: ["tree", workspaceId] }); // the role changed: refetch it
          throw e;
        }
      },
      isConflict: (e) => e instanceof ApiError && e.status === 409,
      describe,
      onState: setState,
    });
    saverRef.current = saver;
    const warn = (e: BeforeUnloadEvent) => { if (saver.hasUnsaved) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (saver.hasUnsaved && modeRef.current === "edit") void saver.flush(); // best effort on leaving the page
      saver.dispose();
      saverRef.current = null;
    };
  }, [file.id, workspaceId, qc]);

  const onChange = useCallback((elements: readonly unknown[], appState: unknown) => {
    latest.current = { elements: elements as Elements, appState: appState as AppState };
    const sig = sceneSignature(elements as Elements, appState as AppState);
    if (lastSig.current === null) { lastSig.current = sig; return; } // the first call is the scene just loaded
    if (sig === lastSig.current || modeRef.current === "view") return;
    lastSig.current = sig;
    saverRef.current?.touch();
  }, []);

  const loadTheirs = async () => {
    try { onReload(await fetchScene(file.id)); } catch { setState({ status: "failed", error: "Could not load the latest version." }); }
  };
  const overwrite = async () => {
    try {
      const fresh = await fetchScene(file.id);
      revision.current = fresh.revision;
      await saverRef.current?.resolveConflict(true);
    } catch { setState({ status: "failed", error: "Could not load the latest version." }); }
  };

  const exportAs = async (kind: "png" | "svg") => {
    const api = apiRef.current;
    if (!api) return;
    const elements = api.getSceneElements() as never;
    const appState = { ...api.getAppState(), exportBackground: true } as never;
    const name = exportFileName(file.name, kind);
    if (kind === "png") downloadBlob(await exportToBlob({ elements, appState, files: null, mimeType: "image/png" }), name);
    else downloadBlob(new Blob([new XMLSerializer().serializeToString(await exportToSvg({ elements, appState, files: null }))], { type: "image/svg+xml" }), name);
  };

  return (
    <div className="flex h-full flex-col">
      <StatusBar mode={mode} state={state} onRetry={() => void saverRef.current?.retry()} onLoadTheirs={() => void loadTheirs()} onOverwrite={() => void overwrite()} onExport={(k) => void exportAs(k)} linksRemoved={linksRemoved} />
      <div className="min-h-0 flex-1" role="application" aria-label={`${file.name} canvas`}>
        <Excalidraw
          initialData={initialData}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          viewModeEnabled={mode === "view"}
          excalidrawAPI={(a) => { apiRef.current = a as unknown as Api; }}
          onChange={onChange as never}
          // Images are out of scope for v1 (they need file storage): no image tool. Pasting or dropping one is
          // caught at save time with a message, and the server rejects image elements too.
          UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false } }}
        />
      </div>
    </div>
  );
}

/** A canvas file: loads its stored scene, autosaves edits (editors and owners), view-only for viewers. */
export default function CanvasEditor({ file, workspaceId, role }: { file: FileEntry; workspaceId: string; role: Tree["role"] | undefined }) {
  const scene = useScene(file.id);
  const [fresh, setFresh] = useState<{ n: number; data: SceneResponse } | null>(null);
  usePageMeta(scene.data || fresh ? undefined : { title: file.name, kind: "canvas", peers: [] });
  if (scene.isPending) return <div className="h-full animate-pulse bg-raised/40" aria-busy="true" aria-label="Loading canvas" />;
  if (scene.isError && !fresh) return <ErrorState title="This canvas didn't open" error={scene.error} onRetry={() => scene.refetch()} className="py-24" />;
  const data = fresh?.data ?? scene.data!;
  return <Surface key={`${file.id}:${fresh?.n ?? 0}`} file={file} workspaceId={workspaceId} role={role} initial={data} onReload={(d) => setFresh({ n: (fresh?.n ?? 0) + 1, data: d })} />;
}
