"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { canEdit, downloadUrl, useUploadVersion, useVersions, type FileEntry, type Role } from "@/api/workspaces";
import { ErrorState, ListSkeleton } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/use-page-meta";
import { formatBytes, formatDateTime } from "@/lib/bytes";

const TEXT_NAME = /\.(md|markdown|txt|csv|json|log)$/i;
const PREVIEW_LIMIT = 200 * 1024;

/** Plain-text preview of one version. Always shown as text in a <pre>, never rendered as HTML. */
function TextPreview({ fileId, versionNo }: { fileId: string; versionNo: number }) {
  const text = useQuery({
    queryKey: ["blob-text", fileId, versionNo],
    queryFn: async () => {
      const res = await fetch(downloadUrl(fileId, versionNo), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`Could not load the file (${res.status})`);
      return res.text();
    },
    staleTime: Infinity, // a version's bytes never change
  });
  if (text.isPending) return <p className="text-sm text-ink-3">Loading preview…</p>;
  if (text.isError) return <ErrorState title="The preview didn't load" error={text.error} onRetry={() => text.refetch()} className="py-6" />;
  return <pre className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-raised p-4 font-mono text-xs leading-relaxed text-ink">{text.data}</pre>;
}

/** An uploaded file: its versions, each downloadable, and "Upload new version" for editors. */
export default function BlobView({ file, workspaceId, role }: { file: FileEntry; workspaceId: string; role: Role }) {
  usePageMeta({ title: file.name, peers: [] });
  const versions = useVersions(file.id);
  const upload = useUploadVersion(workspaceId, file.id);
  const picker = useRef<HTMLInputElement>(null);
  const current = versions.data?.find((v) => v.version_no === file.current_version);

  return (
    <div className="page-x py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-display text-xl font-semibold tracking-tight text-ink">{file.name}</h2><p className="mt-1 text-sm text-ink-2">Each upload is kept as a new version. Older versions stay downloadable.</p></div>
        {canEdit(role) && (
          <>
            <input ref={picker} type="file" hidden aria-label={`New version of ${file.name}`} onChange={(e) => {
              const chosen = e.target.files?.[0]; e.target.value = "";
              if (chosen) upload.mutate(chosen, { onSuccess: (v) => toast.success(`Uploaded version ${v.version_no}`), onError: (err) => toast.error(err.message) });
            }} />
            <Button disabled={upload.isPending} onClick={() => picker.current?.click()}><Upload /> {upload.isPending ? "Uploading…" : "Upload new version"}</Button>
          </>
        )}
      </header>

      {versions.isPending && <ListSkeleton rows={3} />}
      {versions.isError && <ErrorState title="Versions didn't load" error={versions.error} onRetry={() => versions.refetch()} />}
      {versions.data && (
        <div className="overflow-x-auto rounded-xl border border-border bg-panel">
          <table className="w-full min-w-[32rem] text-sm">
            <thead><tr className="text-left text-xs text-ink-3"><th className="px-4 py-3 font-medium">Version</th><th className="px-4 py-3 font-medium">Size</th><th className="px-4 py-3 font-medium">Uploaded</th><th className="px-4 py-3 font-medium">By</th><th className="px-4 py-3"><span className="sr-only">Download</span></th></tr></thead>
            <tbody>
              {versions.data.map((v) => (
                <tr key={v.version_no} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-ink">v{v.version_no}{v.version_no === file.current_version && <span className="ml-2 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">Current</span>}</td>
                  <td className="px-4 py-3 text-ink-2">{formatBytes(v.size_bytes)}</td>
                  <td className="px-4 py-3 text-ink-2">{formatDateTime(v.created_at)}</td>
                  <td className="px-4 py-3 text-ink-2">{v.created_by_name}</td>
                  {/* Served as an attachment by the API; uploaded content is never rendered here. */}
                  <td className="px-4 py-3 text-right"><Button asChild variant="ghost" size="sm"><a href={downloadUrl(file.id, v.version_no)} download={file.name}><Download /> Download</a></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {current && TEXT_NAME.test(file.name) && (
        <section className="mt-8" aria-label="Preview">
          <h3 className="mb-2 text-xs font-medium text-ink-3">Preview of the current version</h3>
          {current.size_bytes > PREVIEW_LIMIT ? <p className="text-sm text-ink-3">Too large to preview here. Download it instead.</p> : <TextPreview fileId={file.id} versionNo={current.version_no} />}
        </section>
      )}
    </div>
  );
}
