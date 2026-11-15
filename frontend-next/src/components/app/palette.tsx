"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { Home, LayoutDashboard, Moon, Settings, Share2, Sparkles } from "lucide-react";
import { KIND_ICON, fileHref } from "@/components/app/file-tree";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { useCurrentWorkspace } from "@/hooks/use-workspace";
import { useUi } from "@/stores/ui";

const KIND_LABEL = { doc: "Doc", sheet: "Sheet", blob: "File" } as const;

export function CommandPalette() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const setShare = useUi((s) => s.setShareOpen);
  const { tree } = useCurrentWorkspace();

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
        <CommandEmpty>No match. Try a file name or an action like &ldquo;share&rdquo;.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => go("/app")}><Home /> Home</CommandItem>
          <CommandItem onSelect={() => go("/app/council")}><Sparkles /> AI Council</CommandItem>
          <CommandItem onSelect={() => go("/app/settings")}><Settings /> Settings</CommandItem>
          <CommandItem onSelect={() => go("/admin")}><LayoutDashboard /> Admin console (preview)</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => setShare(true))}><Share2 /> Share workspace</CommandItem>
          <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}><Moon /> Toggle theme</CommandItem>
        </CommandGroup>
        {tree.data && tree.data.files.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Files">
              {tree.data.files.map((f) => {
                const Icon = KIND_ICON[f.kind];
                return <CommandItem key={f.id} value={`${f.name} ${KIND_LABEL[f.kind]}`} onSelect={() => go(fileHref(f))}><Icon /> {f.name}<CommandShortcut>{KIND_LABEL[f.kind]}</CommandShortcut></CommandItem>;
              })}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
