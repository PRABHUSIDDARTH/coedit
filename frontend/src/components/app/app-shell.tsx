"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useUi } from "@/stores/ui";
import { CommandPalette } from "./palette";
import { ShareDialog } from "./share-dialog";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const open = useUi((s) => s.sidebarOpen);
  const setOpen = useUi((s) => s.setSidebarOpen);
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a href="#app-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2 focus:text-sm">Skip to content</a>
      <aside aria-label="Sidebar" className="hidden w-64 shrink-0 border-r border-border lg:block"><Sidebar /></aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="sr-only"><SheetTitle>Navigation</SheetTitle><SheetDescription>Workspaces and files</SheetDescription></SheetHeader>
          <Sidebar onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="app-main" className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <CommandPalette />
      <ShareDialog />
    </div>
  );
}
