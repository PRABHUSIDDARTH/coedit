import { useState, type FormEvent } from "react";
import { useMemberChange, useMembers, type Role } from "../../api/workspaces";

const ROLES: Role[] = ["owner", "editor", "viewer"];

export function MembersPanel(props: {
  workspaceId: string;
  myRole: Role;
  myUserId: string;
  onClose: () => void;
}) {
  const members = useMembers(props.workspaceId);
  const change = useMemberChange(props.workspaceId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const isOwner = props.myRole === "owner";

  function add(e: FormEvent) {
    e.preventDefault();
    change.mutate({ op: "add", email, role }, { onSuccess: () => setEmail("") });
  }

  return (
    <aside className="panel" aria-label="Members">
      <div className="panel-head">
        <h2>Members</h2>
        <button className="ghost" onClick={props.onClose}>
          Close
        </button>
      </div>
      {members.isLoading && <p className="muted">Loading…</p>}
      <ul className="member-list">
        {members.data?.map((m) => (
          <li key={m.user_id}>
            <span className="member-who">
              <b>{m.display_name}</b>
              {m.user_id === props.myUserId && <span className="muted"> (you)</span>}
              <small className="muted">{m.email}</small>
            </span>
            {isOwner ? (
              <>
                <select
                  value={m.role}
                  aria-label={`Role of ${m.display_name}`}
                  disabled={change.isPending}
                  onChange={(e) =>
                    change.mutate({ op: "setRole", userId: m.user_id, role: e.target.value as Role })
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <button
                  className="icon"
                  title="Remove"
                  aria-label={`Remove ${m.display_name}`}
                  disabled={change.isPending}
                  onClick={() => {
                    if (window.confirm(`Remove ${m.display_name} from this workspace?`))
                      change.mutate({ op: "remove", userId: m.user_id });
                  }}
                >
                  ✕
                </button>
              </>
            ) : (
              <span className="badge">{m.role}</span>
            )}
          </li>
        ))}
      </ul>
      {change.isError && (
        <p className="error" role="alert">
          {change.error.message}
        </p>
      )}
      {isOwner ? (
        <form className="member-add" onSubmit={add}>
          <label>
            Add by email
            <input
              type="email"
              required
              value={email}
              placeholder="teammate@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <select value={role} aria-label="Role" onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <button type="submit" disabled={change.isPending}>
            Add
          </button>
          <small className="muted">They need a coedit account first.</small>
        </form>
      ) : (
        <p className="muted">Only owners can change members.</p>
      )}
    </aside>
  );
}
