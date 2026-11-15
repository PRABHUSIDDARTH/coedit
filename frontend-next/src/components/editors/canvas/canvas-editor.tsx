"use client";

import { convertToExcalidrawElements, Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { usePreviewCollab } from "@/hooks/use-preview-collab";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useTokens } from "@/hooks/use-tokens";
import type { CanvasData } from "@/lib/data/types";

const ME = { id: "u-priya", name: "Priya Nair", seat: 1 };
const TOKENS = ["--azure", "--cyan", "--mint", "--orange", "--sun", "--text-1", "--text-3", "--seat-1", "--seat-2", "--seat-3", "--seat-4", "--seat-5", "--seat-6", "--on-fill"] as const;

// Excalidraw's API surface is large and versioned; we only use updateScene.
type Api = { updateScene: (s: { collaborators?: Map<string, unknown> }) => void };

export default function CanvasEditor({ docId, canvas }: { docId: string; canvas: CanvasData }) {
  const { resolvedTheme } = useTheme();
  // Light values on purpose: Excalidraw derives its own dark rendering from them.
  const t = useTokens(TOKENS, { theme: "light" });
  const [api, setApi] = useState<Api | null>(null);
  const collab = usePreviewCollab(docId, "canvas");
  usePageMeta({ title: canvas.title, kind: "canvas", peers: [ME, ...collab.peers.map((p) => p.collaborator)] });

  const ready = !!t["--azure"];
  const initial = useMemo(() => {
    if (!ready) return null;
    const stroke = (tok: string) => t[`--${tok}` as keyof typeof t];
    const skeleton = [
      ...canvas.nodes.map((n) => ({
        id: n.id, type: "rectangle" as const, x: n.x, y: n.y, width: n.w, height: n.h, roundness: { type: 3 as const },
        strokeColor: stroke(n.token), backgroundColor: "transparent", strokeWidth: 2,
        label: { text: n.label, fontSize: 16 },
      })),
      ...canvas.edges.map(([a, b]) => {
        const from = canvas.nodes.find((n) => n.id === a)!, to = canvas.nodes.find((n) => n.id === b)!;
        const x1 = from.x + from.w, y1 = from.y + from.h / 2, x2 = to.x, y2 = to.y + to.h / 2;
        return { type: "arrow" as const, x: x1, y: y1, width: x2 - x1, height: y2 - y1, strokeWidth: 2, start: { id: a }, end: { id: b } };
      }),
    ];
    return { elements: convertToExcalidrawElements(skeleton), scrollToContent: true };
    // Rebuilt only when the document changes, not on theme flips, so users' edits are not reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, ready]);

  useEffect(() => {
    if (!api || !ready) return;
    const map = new Map<string, unknown>();
    for (const p of collab.peers) {
      if (p.position?.kind !== "canvas") continue;
      const seat = `--seat-${((p.collaborator.seat - 1) % 6) + 1}` as keyof typeof t;
      map.set(p.collaborator.id, {
        pointer: { x: p.position.x, y: p.position.y, tool: "pointer" }, username: p.collaborator.name.split(" ")[0],
        color: { background: t[seat], stroke: t[seat] }, avatarUrl: undefined,
      });
    }
    api.updateScene({ collaborators: map });
  }, [api, collab.peers, ready, t]);

  if (!initial) return <div className="h-full animate-pulse bg-raised/40" aria-busy="true" aria-label="Loading canvas" />;
  return (
    <div className="h-full" role="application" aria-label={`${canvas.title} canvas`}>
      <Excalidraw initialData={initial} theme={resolvedTheme === "dark" ? "dark" : "light"} excalidrawAPI={(a) => setApi(a as unknown as Api)} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }} />
    </div>
  );
}
