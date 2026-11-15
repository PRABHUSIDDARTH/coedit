"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { toast } from "sonner";
import { PageHead, Panel } from "@/components/admin/bits";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import { ErrorState, ListSkeleton } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useRepo } from "@/hooks/use-repo";
import type { Role } from "@/lib/data/types";
import { cn } from "@/lib/utils";

function Field({ id, label, hint, ...p }: React.ComponentProps<typeof Input> & { label: string; hint?: string; id: string }) {
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}</Label><Input id={id} className="h-9" {...p} />{hint && <p className="text-xs text-ink-3">{hint}</p>}</div>;
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const opts = [{ v: "light", label: "Light", icon: Sun }, { v: "dark", label: "Dark", icon: Moon }, { v: "system", label: "System", icon: Monitor }] as const;
  return (
    <div role="radiogroup" aria-label="Theme" className="grid max-w-3xl gap-3 sm:grid-cols-3">
      {opts.map((o) => {
        const on = mounted && theme === o.v;
        return (
          <button key={o.v} type="button" role="radio" aria-checked={on} onClick={() => setTheme(o.v)} className={cn("rounded-xl border bg-panel p-3 text-left transition-colors", on ? "border-azure ring-2 ring-azure/30" : "border-border hover:border-ink-3")}>
            {/* The tile is a live preview: data-theme scopes the brand tokens to this subtree. */}
            <div data-theme={o.v === "system" ? undefined : o.v} className={cn("flex h-20 overflow-hidden rounded-lg border border-border", o.v === "dark" && "dark")} style={o.v === "system" ? undefined : { background: "var(--bg)" }}>
              {o.v === "system" ? (<><div data-theme="light" className="flex-1 bg-background p-2"><div className="h-2 w-8 rounded bg-azure" /><div className="mt-2 h-1.5 w-12 rounded bg-border" /></div><div data-theme="dark" className="dark flex-1 bg-background p-2"><div className="h-2 w-8 rounded bg-azure" /><div className="mt-2 h-1.5 w-12 rounded bg-border" /></div></>) : (
                <div className="flex-1 p-2"><div className="h-2 w-8 rounded bg-azure" /><div className="mt-2 h-1.5 w-14 rounded bg-border" /><div className="mt-1.5 h-1.5 w-10 rounded bg-border" /></div>)}
            </div>
            <span className="mt-2 flex items-center gap-2 text-sm font-medium text-ink"><o.icon className="size-4 text-ink-3" aria-hidden />{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Members() {
  const members = useRepo("members", (r) => r.listMembers());
  const [roles, setRoles] = useState<Record<string, Role>>({});
  if (members.status === "loading") return <ListSkeleton rows={4} />;
  if (members.status === "error") return <ErrorState title="Members didn't load" error={members.error} onRetry={members.reload} />;
  return (
    <Panel>
      <ul className="divide-y divide-border">
        {members.data.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <SeatAvatar name={m.name} seat={m.seat} size={32} />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink">{m.name}</p><p className="truncate text-xs text-ink-3">{m.email}</p></div>
            <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.name}</label>
            <select id={`role-${m.id}`} disabled={m.role === "Owner"} value={roles[m.id] ?? m.role} onChange={(e) => { setRoles((r) => ({ ...r, [m.id]: e.target.value as Role })); toast.success(`${m.name} is now ${e.target.value.toLowerCase()}`); }} className="h-8 rounded-lg border border-input bg-background px-2 text-sm disabled:opacity-60">
              <option>Owner</option><option>Editor</option><option>Viewer</option>
            </select>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function Settings() {
  usePageMeta({ title: "Settings", peers: [] });
  const [del, setDel] = useState(false);
  const save = (what: string) => (e: React.FormEvent) => { e.preventDefault(); toast.success(`${what} saved`); };
  return (
    <div className="page-x py-8">
      <PageHead title="Settings" body="Your profile, this workspace and how Coedit looks." />
      <Tabs defaultValue="profile">
        <TabsList className="mb-6"><TabsTrigger value="profile">Profile</TabsTrigger><TabsTrigger value="workspace">Workspace</TabsTrigger><TabsTrigger value="appearance">Appearance</TabsTrigger><TabsTrigger value="members">Members</TabsTrigger></TabsList>
        <TabsContent value="profile"><form onSubmit={save("Profile")} className="max-w-md space-y-4"><Field id="name" label="Name" defaultValue="Priya Nair" /><Field id="email" label="Email" type="email" defaultValue="priya@northwind.example" hint="We send sign-in links and Council summaries here." /><Button type="submit">Save profile</Button></form></TabsContent>
        <TabsContent value="workspace">
          <form onSubmit={save("Workspace")} className="max-w-md space-y-4"><Field id="ws" label="Workspace name" defaultValue="Northwind Product" /><Field id="slug" label="Address" defaultValue="northwind" hint="coedit.app/northwind" /><Button type="submit">Save workspace</Button></form>
          <div className="mt-10 max-w-md rounded-xl border border-danger/40 p-4"><h3 className="text-sm font-medium text-ink">Delete this workspace</h3><p className="mt-1 text-sm text-ink-2">Every doc, sheet and canvas is removed for everyone. This can&apos;t be undone.</p><Button variant="destructive" className="mt-3" onClick={() => setDel(true)}>Delete workspace</Button></div>
        </TabsContent>
        <TabsContent value="appearance"><Appearance /></TabsContent>
        <TabsContent value="members"><Members /></TabsContent>
      </Tabs>
      <Dialog open={del} onOpenChange={setDel}><DialogContent><DialogHeader><DialogTitle>Delete Northwind Product?</DialogTitle><DialogDescription>This preview doesn&apos;t delete anything, but a real workspace would be removed for all four members.</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" onClick={() => setDel(false)}>Keep workspace</Button><Button variant="destructive" onClick={() => { setDel(false); toast("Nothing was deleted in this preview"); }}>Delete workspace</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
