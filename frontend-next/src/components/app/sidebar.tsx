"use client";

import { ChevronsUpDown, Home, LayoutDashboard, Plus, Search, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Logo } from "@/components/brand/logo";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import { ErrorState, ListSkeleton } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRepo } from "@/hooks/use-repo";
import { hrefFor, KIND_META } from "@/lib/nav";
import type { ItemKind } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";

const NavLink = ({ href, icon: Icon, children, active, onNavigate }: { href: string; icon: React.ElementType; children: React.ReactNode; active: boolean; onNavigate?: () => void }) => (
  <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
    className={cn("flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors", active ? "bg-panel font-medium text-ink shadow-xs ring-1 ring-border" : "text-ink-2 hover:bg-panel/70 hover:text-ink")}>
    <Icon className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{children}</span>
  </Link>
);

const SECTIONS: ItemKind[] = ["doc", "sheet", "canvas"];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { workspaceId, setWorkspaceId, setPaletteOpen } = useUi();
  const workspaces = useRepo("workspaces", (r) => r.listWorkspaces());
  const items = useRepo(`items:${workspaceId}`, (r) => r.listItems(workspaceId));
  const current = workspaces.status === "ready" ? workspaces.data.find((w) => w.id === workspaceId) ?? workspaces.data[0] : undefined;

  const create = (kind: ItemKind) => {
    toast("Creating files needs the backend. Opening a sample instead.");
    const sample = items.status === "ready" ? items.data.find((i) => i.kind === kind) : undefined;
    if (sample) { onNavigate?.(); router.push(hrefFor(sample)); }
  };

  return (
    <div className="flex h-full flex-col gap-4 bg-raised p-3">
      <div className="flex items-center justify-between px-1 pt-1"><Link href="/app" aria-label="Coedit home" onClick={onNavigate}><Logo height={24} /></Link></div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-10 justify-start gap-2.5 bg-panel px-2 font-medium" aria-label="Switch workspace">
            <span className="flex size-6 items-center justify-center rounded-md bg-azure text-[11px] font-semibold text-on-fill">{current?.initials ?? "…"}</span>
            <span className="min-w-0 flex-1 truncate text-left">{current?.name ?? "Loading"}</span>
            <ChevronsUpDown className="text-ink-3" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.status === "ready" && workspaces.data.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => setWorkspaceId(w.id)}>
              <span className="flex size-5 items-center justify-center rounded bg-raised text-[10px] font-semibold text-ink">{w.initials}</span>{w.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => toast("Creating workspaces needs the backend.")}><Plus /> New workspace</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button type="button" onClick={() => setPaletteOpen(true)}
        className="flex h-8 items-center gap-2 rounded-md border border-border bg-panel px-2 text-sm text-ink-3 transition-colors hover:text-ink">
        <Search className="size-4" aria-hidden /><span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-border bg-raised px-1.5 font-mono text-[10px] text-ink-3">⌘K</kbd>
      </button>

      <nav aria-label="Workspace" className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1">
        <div className="space-y-0.5">
          <NavLink href="/app" icon={Home} active={pathname === "/app"} onNavigate={onNavigate}>Home</NavLink>
          <NavLink href="/app/council" icon={Sparkles} active={pathname.startsWith("/app/council")} onNavigate={onNavigate}>AI Council</NavLink>
        </div>

        {items.status === "loading" && <ListSkeleton rows={6} />}
        {items.status === "error" && <ErrorState title="Files didn't load" error={items.error} onRetry={items.reload} className="py-6" />}
        {items.status === "ready" && SECTIONS.map((kind) => {
          const meta = KIND_META[kind];
          const list = items.data.filter((i) => i.kind === kind);
          return (
            <div key={kind}>
              <div className="mb-1 flex items-center justify-between px-2">
                <h2 className="text-xs font-medium text-ink-3">{meta.plural}</h2>
                <Button variant="ghost" size="icon-xs" aria-label={`New ${meta.label.toLowerCase()}`} onClick={() => create(kind)}><Plus /></Button>
              </div>
              <div className="space-y-0.5">
                {list.length === 0 && <p className="px-2 py-1 text-xs text-ink-3">No {meta.plural.toLowerCase()} yet.</p>}
                {list.map((i) => <NavLink key={i.id} href={hrefFor(i)} icon={meta.icon} active={pathname === hrefFor(i)} onNavigate={onNavigate}>{i.title}</NavLink>)}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-border pt-3">
        <NavLink href="/app/settings" icon={Settings} active={pathname.startsWith("/app/settings")} onNavigate={onNavigate}>Settings</NavLink>
        <NavLink href="/admin" icon={LayoutDashboard} active={false} onNavigate={onNavigate}>Admin console</NavLink>
        <div className="flex items-center gap-2.5 px-2 pt-2"><SeatAvatar name="Priya Nair" seat={1} size={24} /><div className="min-w-0"><p className="truncate text-xs font-medium text-ink">Priya Nair</p><p className="truncate text-[11px] text-ink-3">Owner</p></div></div>
      </div>
    </div>
  );
}
