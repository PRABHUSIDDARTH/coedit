"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { ErrorState } from "@/components/states/states";
import { useRepo } from "@/hooks/use-repo";
import { usePageMeta } from "@/hooks/use-page-meta";

const SheetEditor = dynamic(() => import("@/components/editors/sheet/sheet-editor"), { ssr: false, loading: () => <Loading /> });

function Loading() {
  return <div className="animate-pulse p-4" aria-busy="true" aria-label="Loading sheet"><div className="h-8 w-full rounded bg-raised" /><div className="mt-2 space-y-1">{Array.from({ length: 9 }, (_, i) => <div key={i} className="h-8 rounded bg-raised/60" />)}</div></div>;
}

export default function SheetPage() {
  const { id } = useParams<{ id: string }>();
  const sheet = useRepo(`sheet:${id}`, (r) => r.getSheet(id));
  usePageMeta(sheet.status === "ready" ? undefined : { title: sheet.status === "error" ? "Sheet" : "Loading…", kind: "sheet", peers: [] });
  if (sheet.status === "loading") return <Loading />;
  if (sheet.status === "error") return <ErrorState title="This sheet didn't open" error={sheet.error} onRetry={sheet.reload} />;
  return <div className="h-full"><SheetEditor key={id} docId={id} sheet={sheet.data} /></div>;
}
