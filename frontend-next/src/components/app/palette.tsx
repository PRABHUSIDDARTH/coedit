"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { Home, LayoutDashboard, Moon, Plus, Settings, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { useRepo } from "@/hooks/use-repo";
import { hrefFor, KIND_META } from "@/lib/nav";
import { useUi } from "@/stores/ui";

export function CommandPalette() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const setShare = useUi((s) => s.setShareOpen);
  const workspaceId = useUi((s) => s.workspaceId);
  const items = useRepo(`items:${workspaceId}`, (r) => r.listItems(workspaceId));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); useUi.getState().setPaletteOpen(!useUi.getState().paletteOpen); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => { setOpen(false); router.push(href); };
  const run = (fn: () => void) => { setOpen(false); fn(); };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search files and run actions">
      <CommandInput placeholder="Search files or type a command" />
      <CommandList>
        <CommandEmpty>No match. Try a file name or an action like &ldquo;new doc&rdquo;.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => go("/app")}><Home /> Home</CommandItem>
          <CommandItem onSelect={() => go("/app/council")}><Sparkles /> AI Council</CommandItem>
          <CommandItem onSelect={() => go("/app/settings")}><Settings /> Settings</CommandItem>
          <CommandItem onSelect={() => go("/admin")}><LayoutDashboard /> Admin console</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => toast("New files need the backend. Opening a sample doc."))}><Plus /> New doc</CommandItem>
          <CommandItem onSelect={() => run(() => setShare(true))}><Share2 /> Share workspace <CommandShortcut>S</CommandShortcut></CommandItem>
          <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}><Moon /> Toggle theme</CommandItem>
        </CommandGroup>
        {items.status === "ready" && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Files">
              {items.data.map((i) => {
                const Icon = KIND_META[i.kind].icon;
                return <CommandItem key={i.id} value={`${i.title} ${KIND_META[i.kind].label}`} onSelect={() => go(hrefFor(i))}><Icon /> {i.title}<CommandShortcut>{KIND_META[i.kind].label}</CommandShortcut></CommandItem>;
              })}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
