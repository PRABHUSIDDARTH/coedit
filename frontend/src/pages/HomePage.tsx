import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLogout, type User } from "../api/auth";
import { useCreateWorkspace, useWorkspaces } from "../api/workspaces";

export function HomePage({ user }: { user: User }) {
  const logout = useLogout();
  const workspaces = useWorkspaces();
  const create = useCreateWorkspace();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate(name, { onSuccess: (ws) => navigate(`/w/${ws.id}`) });
  }

  return (
    <div className="shell">
      <header className="topbar">
        <strong className="brand">coedit</strong>
        <span className="spacer" />
        <span title={user.email}>{user.display_name}</span>
        <button className="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
          Sign out
        </button>
      </header>
      <main className="content narrow">
        <h2>Workspaces</h2>
        {workspaces.isLoading && <p className="muted">Loading…</p>}
        {workspaces.isError && <p className="error">{workspaces.error.message}</p>}
        {workspaces.data?.length === 0 && (
          <p className="muted">You're not in any workspace yet. Create one, or ask an owner to add you.</p>
        )}
        <ul className="ws-list">
          {workspaces.data?.map((w) => (
            <li key={w.id}>
              <Link to={`/w/${w.id}`}>{w.name}</Link>
              <span className="badge">{w.role}</span>
            </li>
          ))}
        </ul>
        <form className="inline-form" onSubmit={onSubmit}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New workspace name"
            aria-label="New workspace name"
            maxLength={200}
            required
          />
          <button type="submit" disabled={create.isPending || !name.trim()}>
            Create workspace
          </button>
        </form>
        {create.isError && (
          <p className="error" role="alert">
            {create.error.message}
          </p>
        )}
      </main>
    </div>
  );
}
