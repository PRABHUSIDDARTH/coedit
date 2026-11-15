"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMe } from "@/api/auth";
import { ApiError } from "@/api/client";
import { useMemberChange, useMembers, type Role } from "@/api/workspaces";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import { ErrorState, ListSkeleton } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { seatForUser } from "@/lib/seats";

const ROLES: Role[] = ["owner", "editor", "viewer"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function MembersPanel({ workspaceId, myRole }: { workspaceId: string; myRole: Role | undefined }) {
  const me = useMe();
  const members = useMembers(workspaceId);
  const change = useMemberChange(workspaceId);
  const [role, setRole] = useState<Role>("editor");
  const isOwner = myRole === "owner";
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Couldn't update members");

  return (
    <div className="space-y-4">
      {isOwner && (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget; const email = String(new FormData(form).get("email") ?? "").trim();
          change.mutate({ op: "add", email, role }, { onSuccess: () => { toast.success(`Added ${email}`); form.reset(); }, onError: fail });
        }}>
          <Input name="email" type="email" required placeholder="Email of a registered user" aria-label="Email address" className="min-w-0 flex-1" />
          <select aria-label="Role for the new member" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-8 rounded-lg border border-input bg-background px-2 text-sm">{ROLES.map((r) => <option key={r} value={r}>{cap(r)}</option>)}</select>
          <Button type="submit" disabled={change.isPending}>Add member</Button>
        </form>
      )}
      {!isOwner && <p className="text-xs text-ink-3">Only owners can add or remove members.</p>}
      {members.isPending && <ListSkeleton rows={3} />}
      {members.isError && <ErrorState title="Members didn't load" error={members.error} onRetry={() => members.refetch()} className="py-6" />}
      {members.data && (
        <ul className="divide-y divide-border rounded-xl border border-border bg-panel" aria-label="Members">
          {members.data.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <SeatAvatar name={m.display_name} seat={seatForUser(m.user_id)} size={32} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{m.display_name}{m.user_id === me.data?.id && <span className="ml-2 text-xs font-normal text-ink-3">You</span>}</p><p className="truncate text-xs text-ink-3">{m.email}</p></div>
              <label className="sr-only" htmlFor={`role-${m.user_id}`}>Role for {m.display_name}</label>
              <select id={`role-${m.user_id}`} disabled={!isOwner || change.isPending} value={m.role} onChange={(e) => change.mutate({ op: "setRole", userId: m.user_id, role: e.target.value as Role }, { onError: fail })} className="h-8 rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-60">{ROLES.map((r) => <option key={r} value={r}>{cap(r)}</option>)}</select>
              {isOwner && <Button variant="ghost" size="sm" disabled={change.isPending} onClick={() => change.mutate({ op: "remove", userId: m.user_id }, { onSuccess: () => toast.success(`Removed ${m.display_name}`), onError: fail })}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
