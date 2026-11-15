"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { ErrorState } from "@/components/states/states";
import { useRepo } from "@/hooks/use-repo";
import { usePageMeta } from "@/hooks/use-page-meta";

// Excalidraw is large and browser-only: load it when a canvas is opened.
const CanvasEditor = dynamic(() => import("@/components/editors/canvas/canvas-editor"), { ssr: false, loading: () => <Loading /> });

function Loading() {
  return <div className="h-full animate-pulse bg-raised/40" aria-busy="true" aria-label="Loading canvas" />;
}

export default function CanvasPage() {
  const { id } = useParams<{ id: string }>();
  const canvas = useRepo(`canvas:${id}`, (r) => r.getCanvas(id));
  usePageMeta(canvas.status === "ready" ? undefined : { title: canvas.status === "error" ? "Canvas" : "Loading…", kind: "canvas", peers: [] });
  if (canvas.status === "loading") return <Loading />;
  if (canvas.status === "error") return <ErrorState title="This canvas didn't open" error={canvas.error} onRetry={canvas.reload} />;
  return <div className="h-full"><CanvasEditor key={id} docId={id} canvas={canvas.data} /></div>;
}
