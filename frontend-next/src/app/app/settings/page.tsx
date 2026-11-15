"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useMe } from "@/api/auth";
import { PageHead } from "@/components/admin/bits";
import { MembersPanel } from "@/components/app/members-panel";
import { ProviderKeys } from "@/components/council/keys";
import { EmptyState } from "@/components/states/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMounted } from "@/hooks/use-mounted";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useCurrentWorkspace } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="space-y-1"><dt className="text-xs text-ink-3">{label}</dt><dd className="text-sm text-ink">{value}</dd></div>;
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
            {/* Each tile is a live preview: data-theme scopes the brand tokens to this subtree. */}
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

export default function Settings() {
  usePageMeta({ title: "Settings", peers: [] });
  const me = useMe();
  const { current } = useCurrentWorkspace();
  return (
    <div className="page-x py-8">
      <PageHead title="Settings" body="Your account, this workspace, your provider keys and how Coedit looks." />
      <Tabs defaultValue="profile">
        <TabsList className="mb-6 flex-wrap"><TabsTrigger value="profile">Profile</TabsTrigger><TabsTrigger value="workspace">Workspace</TabsTrigger><TabsTrigger value="members">Members</TabsTrigger><TabsTrigger value="keys">API keys</TabsTrigger><TabsTrigger value="appearance">Appearance</TabsTrigger></TabsList>

        <TabsContent value="profile">
          <dl className="grid max-w-md gap-4"><Fact label="Name" value={me.data?.display_name ?? "…"} /><Fact label="Email" value={me.data?.email ?? "…"} /><Fact label="Member since" value={me.data ? new Date(me.data.created_at).toLocaleDateString("en", { dateStyle: "medium" }) : "…"} /></dl>
          <p className="mt-6 max-w-md text-sm text-ink-3">Changing your name, email or password isn&apos;t available yet.</p>
        </TabsContent>

        <TabsContent value="workspace">
          {current ? (
            <>
              <dl className="grid max-w-md gap-4"><Fact label="Name" value={current.name} /><Fact label="Your role" value={current.role[0].toUpperCase() + current.role.slice(1)} /><Fact label="Workspace id" value={current.id} /></dl>
              <p className="mt-6 max-w-md text-sm text-ink-3">Renaming or deleting a workspace isn&apos;t available yet.</p>
            </>
          ) : <EmptyState title="No workspace selected" body="Create or pick a workspace from the sidebar." />}
        </TabsContent>

        <TabsContent value="members">
          {current ? <div className="max-w-3xl"><MembersPanel workspaceId={current.id} myRole={current.role} /></div> : <EmptyState title="No workspace selected" body="Create or pick a workspace from the sidebar." />}
        </TabsContent>

        <TabsContent value="keys">
          <div className="max-w-xl space-y-3">
            <p className="text-sm text-ink-2">Keys the Council uses when you start a run. They belong to you, are encrypted on the server, and only the last four characters are ever shown.</p>
            <ProviderKeys />
          </div>
        </TabsContent>

        <TabsContent value="appearance"><Appearance /></TabsContent>
      </Tabs>
    </div>
  );
}
