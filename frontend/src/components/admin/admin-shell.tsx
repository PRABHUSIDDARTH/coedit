"use client";

import { Activity, ArrowLeft, KeyRound, ScrollText, Shuffle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { PreviewNote } from "@/components/states/preview-note";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: Activity },
  { href: "/admin/routing", label: "Seats and routing", icon: Shuffle },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/keys", label: "API keys", icon: KeyRound },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3"><Logo height={22} /><span className="rounded-md border border-border bg-raised px-2 py-0.5 text-xs font-medium text-ink-2">Admin console</span></div>
        <div className="flex items-center gap-2"><Link href="/app" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-raised hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> Back to workspace</Link><ThemeToggle /></div>
      </header>
      <PreviewNote>There is no admin backend yet, so this console shows sample data. Nothing here changes your workspace.</PreviewNote>
      <div className="flex flex-1 flex-col md:flex-row">
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto border-b border-border bg-raised p-2 md:w-56 md:flex-col md:border-b-0 md:border-r md:p-3">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}
              className={cn("flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors", path === n.href ? "bg-panel font-medium text-ink ring-1 ring-border" : "text-ink-2 hover:bg-panel/70 hover:text-ink")}>
              <n.icon className="size-4 text-ink-3" aria-hidden />{n.label}
            </Link>
          ))}
        </nav>
        <main id="admin-main" className="min-w-0 flex-1 page-x py-6">{children}</main>
      </div>
    </div>
  );
}
