"use client";

import { FileX } from "lucide-react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import type { FileEntry, FileKind, Tree } from "@/api/workspaces";
import { EmptyState } from "@/components/states/states";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useFileLookup } from "@/hooks/use-file";

const DocEditor = dynamic(() => import("@/components/editors/doc/doc-editor"), { ssr: false, loading: () => <Loading /> });
const SheetEditor = dynamic(() => import("@/components/editors/sheet/sheet-editor"), { ssr: false, loading: () => <Loading /> });
const BlobView = dynamic(() => import("@/components/editors/blob/blob-view"), { ssr: false, loading: () => <Loading /> });

function Loading() {
  return <div className="p-6" aria-busy="true" aria-label="Loading"><Skeleton className="h-8 w-1/3" /><Skeleton className="mt-6 h-48 w-full" /></div>;
}

/** Looks the file up, checks it is the kind this route expects, and renders the right editor. */
export function FilePage({ kind }: { kind: FileKind }) {
  const { id } = useParams<{ id: string }>();
  const { loading, file, workspace, role } = useFileLookup(id);
  usePageMeta(file ? undefined : { title: loading ? "Loading…" : "Not found", kind: kind === "blob" ? undefined : kind, peers: [] });

  if (loading) return <Loading />;
  if (!file || !workspace) return <EmptyState icon={FileX} className="py-24" title="This file isn't available" body="It may have been deleted, or you may not have access to the workspace it lives in." />;
  if (file.kind !== kind) return <EmptyState icon={FileX} className="py-24" title={`This isn't a ${kind === "blob" ? "stored file" : kind}`} body={`“${file.name}” is a ${file.kind === "blob" ? "stored file" : file.kind}. Open it from the sidebar.`} />;
  const common = { file: file as FileEntry };
  if (kind === "doc") return <div className="h-full"><DocEditor key={file.id} {...common} /></div>;
  if (kind === "sheet") return <div className="h-full"><SheetEditor key={file.id} {...common} /></div>;
  return <BlobView key={file.id} {...common} workspaceId={workspace.id} role={role as Tree["role"]} />;
}
