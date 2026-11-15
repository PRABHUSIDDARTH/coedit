"use client";

import { ChevronsUpDown, Home, LayoutDashboard, LogOut, PenTool, Plus, Search, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useLogout, useMe } from "@/api/auth";
import { ApiError } from "@/api/client";
import { useCreateWorkspace } from "@/api/workspaces";
import { NameDialog } from "@/components/app/dialogs";
import { FileTree, NewMenu, useFileActions } from "@/components/app/file-tree";
import { Logo } from "@/components/brand/logo";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import { ErrorState, ListSkeleton } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCurrentWorkspace } from "@/hooks/use-workspace";
import { seatForUser } from "@/lib/seats";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";

const NavLink = ({ href, icon: Icon, children, active, onNavigate }: { href: string; icon: React.ElementType; children: React.ReactNode; active: boolean; onNavigate?: () => void }) => (
  <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
    className={cn("flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors", active ? "bg-panel font-medium text-ink shadow-xs ring-1 ring-border" : "text-ink-2 hover:bg-panel/70 hover:text-ink")}>
    <Icon className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{children}</span>
  </Link>
);

const initialsOf = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setWorkspaceId, setPaletteOpen } = useUi();
  const { workspaces, current, tree } = useCurrentWorkspace();
  const me = useMe();
  const logout = useLogout();
  const createWorkspace = useCreateWorkspace();
  const [naming, setNaming] = useState(false);
  const { actions, inputs } = useFileActions(current?.id ?? "", tree.data, onNavigate);

  const submitWorkspace = (name: string) => {
    setNaming(false);
    createWorkspace.mutate(name, { onSuccess: (w) => { setWorkspaceId(w.id); toast.success(`Created ${w.name}`); }, onError: (e) => toast.error(e instanceof ApiError ? e.message : "Couldn't create the workspace") });
  };
  const user = me.data;

  return (
    <div className="flex h-full flex-col gap-4 bg-raised p-3">
      <div className="flex items-center justify-between px-1 pt-1"><Link href="/app" aria-label="Coedit home" onClick={onNavigate}><Logo height={24} /></Link></div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-10 justify-start gap-2.5 bg-panel px-2 font-medium" aria-label="Switch workspace">
            <span className="flex size-6 items-center justify-center rounded-md bg-azure text-[11px] font-semibold text-on-fill">{current ? initialsOf(current.name) : "…"}</span>
            <span className="min-w-0 flex-1 truncate text-left">{current?.name ?? (workspaces.isError ? "Unavailable" : workspaces.isPending ? "Loading" : "No workspace")}</span>
            <ChevronsUpDown className="text-ink-3" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.data?.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => setWorkspaceId(w.id)}>
              <span className="flex size-5 items-center justify-center rounded bg-raised text-[10px] font-semibold text-ink">{initialsOf(w.name)}</span><span className="truncate">{w.name}</span><span className="ml-auto text-xs text-ink-3">{w.role}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setNaming(true)}><Plus /> New workspace</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button type="button" onClick={() => setPaletteOpen(true)} className="flex h-8 items-center gap-2 rounded-md border border-border bg-panel px-2 text-sm text-ink-3 transition-colors hover:text-ink">
        <Search className="size-4" aria-hidden /><span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-border bg-raised px-1.5 font-mono text-[10px] text-ink-3">⌘K</kbd>
      </button>

      <nav aria-label="Workspace" className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1">
        <div className="space-y-0.5">
          <NavLink href="/app" icon={Home} active={pathname === "/app"} onNavigate={onNavigate}>Home</NavLink>
          <NavLink href="/app/council" icon={Sparkles} active={pathname.startsWith("/app/council")} onNavigate={onNavigate}>AI Council</NavLink>
          <NavLink href="/app/canvas/onboarding-flow" icon={PenTool} active={pathname.startsWith("/app/canvas")} onNavigate={onNavigate}>Canvas <span className="ml-1 rounded border border-border px-1 text-[10px] text-ink-3">Preview</span></NavLink>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between px-2">
            <h2 className="text-xs font-medium text-ink-3">Files</h2>
            {current && actions.editable && <NewMenu actions={actions} trigger={<Button variant="ghost" size="icon-xs" aria-label="New file or folder"><Plus /></Button>} />}
          </div>
          {workspaces.isError && <ErrorState title="Workspaces didn't load" error={workspaces.error} onRetry={() => workspaces.refetch()} className="py-6" />}
          {workspaces.isPending && <ListSkeleton rows={6} />}
          {workspaces.isSuccess && !current && <p className="px-2 py-1 text-xs text-ink-3">Create a workspace to start.</p>}
          {current && tree.isPending && <ListSkeleton rows={5} />}
          {current && tree.isError && <ErrorState title="Files didn't load" error={tree.error} onRetry={() => tree.refetch()} className="py-6" />}
          {tree.data && <FileTree tree={tree.data} actions={actions} onNavigate={onNavigate} />}
        </div>
      </nav>

      <div className="space-y-0.5 border-t border-border pt-3">
        <NavLink href="/app/settings" icon={Settings} active={pathname.startsWith("/app/settings")} onNavigate={onNavigate}>Settings</NavLink>
        <NavLink href="/admin" icon={LayoutDashboard} active={false} onNavigate={onNavigate}>Admin console <span className="ml-1 rounded border border-border px-1 text-[10px] text-ink-3">Preview</span></NavLink>
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-panel/70" aria-label="Account menu">
                <SeatAvatar name={user.display_name} seat={seatForUser(user.id)} size={24} />
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-ink">{user.display_name}</span><span className="block truncate text-[11px] text-ink-3">{current?.role ?? user.email}</span></span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => router.push("/app/settings")}><Settings /> Settings</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => logout.mutate(undefined, { onSuccess: () => router.replace("/login") })}><LogOut /> Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {inputs}
      {naming && <NameDialog title="New workspace" label="Name" confirm="Create workspace" onSubmit={submitWorkspace} onClose={() => setNaming(false)} />}
    </div>
  );
}
