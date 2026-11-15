"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { ErrorState } from "@/components/states/states";
import { useRepo } from "@/hooks/use-repo";
import { usePageMeta } from "@/hooks/use-page-meta";

// The editor is heavy: load it only when a document is opened.
const DocEditor = dynamic(() => import("@/components/editors/doc/doc-editor"), { ssr: false, loading: () => <Loading /> });

function Loading() {
  return <div className="animate-pulse page-x py-16" aria-busy="true" aria-label="Loading document"><div className="h-9 w-2/3 rounded bg-raised" /><div className="mt-8 space-y-3"><div className="h-4 rounded bg-raised" /><div className="h-4 w-11/12 rounded bg-raised" /><div className="h-4 w-4/5 rounded bg-raised" /></div></div>;
}

export default function DocPage() {
  const { id } = useParams<{ id: string }>();
  const doc = useRepo(`doc:${id}`, (r) => r.getDoc(id));
  usePageMeta(doc.status === "ready" ? undefined : { title: doc.status === "error" ? "Document" : "Loading…", kind: "doc", peers: [] });
  if (doc.status === "loading") return <Loading />;
  if (doc.status === "error") return <ErrorState title="This document didn't open" error={doc.error} onRetry={doc.reload} />;
  return <div className="h-full"><DocEditor key={id} docId={id} doc={doc.data} /></div>;
}
