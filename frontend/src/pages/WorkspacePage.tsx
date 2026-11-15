import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLogout, type User } from "../api/auth";
import { ApiError } from "../api/client";
import { useTree, useWorkspaces } from "../api/workspaces";
import { BlobView } from "../components/BlobView/BlobView";
import { CouncilPanel } from "../components/CouncilPanel/CouncilPanel";
import { FileTree } from "../components/FileTree/FileTree";
import { FileView } from "./FileView";
import { MembersPanel } from "../components/Members/MembersPanel";

export function WorkspacePage({ user }: { user: User }) {
  const { workspaceId = "", fileId } = useParams();
  const navigate = useNavigate();
  const logout = useLogout();
  const workspaces = useWorkspaces();
  const tree = useTree(workspaceId);
  const [panel, setPanel] = useState<"members" | "council" | null>(null);
  const toggle = (which: "members" | "council") => setPanel((p) => (p === which ? null : which));

  const file = fileId ? tree.data?.files.find((f) => f.id === fileId) : undefined;
  const notFound = tree.error instanceof ApiError && [404, 422].includes(tree.error.status);

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          coedit
        </Link>
        <select
          aria-label="Workspace"
          value={workspaceId}
          onChange={(e) => navigate(`/w/${e.target.value}`)}
        >
          {!workspaces.data?.some((w) => w.id === workspaceId) && <option value={workspaceId}>…</option>}
          {workspaces.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {tree.data && <span className="badge">{tree.data.role}</span>}
        <span className="spacer" />
        {tree.data?.role === "owner" && (
          <button className="ghost" aria-pressed={panel === "council"} onClick={() => toggle("council")}>
            AI council
          </button>
        )}
        {tree.data && (
          <button className="ghost" aria-pressed={panel === "members"} onClick={() => toggle("members")}>
            Members
          </button>
        )}
        <span title={user.email}>{user.display_name}</span>
        <button className="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Sign out
        </button>
      </header>

      {tree.isLoading && <p className="center muted">Loading…</p>}
      {tree.isError && (
        <p className="center">
          {notFound ? "This workspace doesn't exist, or you're not a member." : tree.error.message}{" "}
          <Link to="/">Back to workspaces</Link>
        </p>
      )}
      {tree.data && (
        <div className="workspace">
          <FileTree workspaceId={workspaceId} tree={tree.data} />
          <main className={file ? "content flush" : "content"}>
            {!fileId && <p className="muted">Pick a file on the left, or create one.</p>}
            {fileId && !file && <p className="muted">This file was deleted or moved out of reach.</p>}
            {file && file.kind !== "blob" && <FileView key={file.id} file={file} />}
            {file && file.kind === "blob" && (
              <BlobView key={file.id} workspaceId={workspaceId} file={file} role={tree.data.role} />
            )}
          </main>
          {panel === "council" && tree.data.role === "owner" && (
            <CouncilPanel workspaceId={workspaceId} tree={tree.data} onClose={() => setPanel(null)} />
          )}
          {panel === "members" && (
            <MembersPanel
              workspaceId={workspaceId}
              myRole={tree.data.role}
              myUserId={user.id}
              onClose={() => setPanel(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
