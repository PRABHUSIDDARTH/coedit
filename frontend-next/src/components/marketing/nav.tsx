"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const LINKS = [
  { href: "#docs", label: "Docs" },
  { href: "#sheets", label: "Sheets" },
  { href: "#canvas", label: "Canvas" },
  { href: "#council", label: "AI Council" },
  { href: "#pricing", label: "Pricing" },
];

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex h-14 items-center justify-between page-x">
        <Link href="/" aria-label="Coedit home"><Logo height={26} /></Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-md px-3 py-1.5 text-sm text-ink-2 transition-colors hover:bg-raised hover:text-ink">{l.label}</a>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="/login">Sign in</Link></Button>
          <Button asChild size="sm" className="hidden bg-tidal text-on-fill hover:opacity-90 sm:inline-flex"><Link href="/signup">Start free</Link></Button>
          <Sheet>
            <SheetTrigger asChild><Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu"><Menu /></Button></SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader><SheetTitle><Logo height={24} /></SheetTitle></SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
                {LINKS.map((l) => <a key={l.href} href={l.href} className="rounded-md px-3 py-2 text-sm text-ink hover:bg-raised">{l.label}</a>)}
                <hr className="my-2 border-border" />
                <Link href="/login" className="rounded-md px-3 py-2 text-sm text-ink hover:bg-raised">Sign in</Link>
                <Button asChild className="mt-1 bg-tidal text-on-fill"><Link href="/signup">Start free</Link></Button>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
