"use client";

import { Menu, Search, Share2 } from "lucide-react";
import { AvatarStack } from "@/components/presence/seat-avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { KIND_META } from "@/lib/nav";
import { useUi } from "@/stores/ui";

export function TopBar() {
  const { meta, setSidebarOpen, setPaletteOpen, setShareOpen } = useUi();
  const KindIcon = meta?.kind ? KIND_META[meta.kind].icon : null;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu /></Button>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        {KindIcon && <KindIcon className="size-4 shrink-0 text-ink-3" aria-hidden />}
        <h1 className="truncate font-medium text-ink">{meta?.title ?? "Home"}</h1>
      </div>
      {meta && meta.peers.length > 0 && <AvatarStack people={meta.peers} size={26} />}
      <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}><Share2 /> Share</Button>
      <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Search" onClick={() => setPaletteOpen(true)}><Search /></Button>
      <ThemeToggle />
    </header>
  );
}
