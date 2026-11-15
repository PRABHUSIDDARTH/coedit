import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  canEdit,
  downloadUrl,
  useUploadVersion,
  useVersions,
  type FileEntry,
  type Role,
} from "../../api/workspaces";
import { formatBytes, formatDateTime } from "../../lib/format";

const TEXT_NAME = /\.(md|markdown|txt|csv|json|log)$/i;
const PREVIEW_LIMIT = 200 * 1024;

/** Plain-text preview of the current version. Shown as text in a <pre>; never rendered as HTML. */
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
  if (text.isLoading) return <p className="muted">Loading preview…</p>;
  if (text.isError) return <p className="error">{text.error.message}</p>;
  return <pre className="blob-preview">{text.data}</pre>;
}

/** An uploaded file: its versions, each downloadable, and "upload new version" for editors. */
export function BlobView(props: { workspaceId: string; file: FileEntry; role: Role }) {
  const { file } = props;
  const versions = useVersions(file.id);
  const upload = useUploadVersion(props.workspaceId, file.id);
  const picker = useRef<HTMLInputElement>(null);

  return (
    <section className="file-view">
      <header className="file-head">
        <h2>{file.name}</h2>
        {canEdit(props.role) && (
          <>
            <input
              ref={picker}
              type="file"
              hidden
              aria-label={`New version of ${file.name}`}
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) upload.mutate(chosen);
                e.target.value = ""; // allow choosing the same file again
              }}
            />
            <button disabled={upload.isPending} onClick={() => picker.current?.click()}>
              {upload.isPending ? "Uploading…" : "Upload new version"}
            </button>
          </>
        )}
      </header>
      <div className="blob-body">
        {upload.isError && (
          <p className="error" role="alert">
            {upload.error.message}
          </p>
        )}
        {versions.isLoading && <p className="muted">Loading…</p>}
        {versions.isError && <p className="error">{versions.error.message}</p>}
        {versions.data && (
          <table className="versions">
            <thead>
              <tr>
                <th>Version</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>By</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.data.map((v) => (
                <tr key={v.version_no}>
                  <td>
                    v{v.version_no}
                    {v.version_no === file.current_version && <span className="badge">current</span>}
                  </td>
                  <td>{formatBytes(v.size_bytes)}</td>
                  <td>{formatDateTime(v.created_at)}</td>
                  <td>{v.created_by_name}</td>
                  <td>
                    {/* Served as an attachment by the API; uploaded content is never rendered here. */}
                    <a href={downloadUrl(file.id, v.version_no)} download={file.name}>
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(() => {
          const current = versions.data?.find((v) => v.version_no === file.current_version);
          if (!current || !TEXT_NAME.test(file.name)) return null;
          if (current.size_bytes > PREVIEW_LIMIT)
            return <p className="muted">Too large to preview here; download it instead.</p>;
          return <TextPreview fileId={file.id} versionNo={current.version_no} />;
        })()}
      </div>
    </section>
  );
}
