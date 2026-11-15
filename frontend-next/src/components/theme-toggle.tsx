"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRef } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

type VT = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };

/** One click flips light and dark. Where the browser supports view transitions the new theme is
 *  revealed as a circle growing from the button; reduced-motion users get an instant switch. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const ref = useRef<HTMLButtonElement>(null);
  const dark = mounted && resolvedTheme === "dark";

  const flip = () => {
    const next = dark ? "light" : "dark";
    const doc = document as VT;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduce) return setTheme(next);
    const r = ref.current!.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    doc.startViewTransition(() => setTheme(next)).ready.then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: "cubic-bezier(.4,0,.2,1)", pseudoElement: "::view-transition-new(root)" },
      ));
  };

  return (
    <button ref={ref} type="button" role="switch" aria-checked={dark} aria-label="Dark mode" title={dark ? "Switch to light" : "Switch to dark"} onClick={flip}
      className={cn("relative inline-flex h-8 w-[3.75rem] shrink-0 items-center rounded-full border border-border bg-raised p-0.5 transition-colors hover:border-azure focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
      <Sun className="absolute left-2 size-3.5 text-ink-3" aria-hidden />
      <Moon className="absolute right-2 size-3.5 text-ink-3" aria-hidden />
      <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 34 }}
        className={cn("relative z-10 flex size-6 items-center justify-center rounded-full bg-panel text-ink shadow-sm ring-1 ring-border", dark && "ml-auto")}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={dark ? "moon" : "sun"} initial={{ rotate: -90, scale: 0.4, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.4, opacity: 0 }} transition={{ duration: 0.16 }} className="flex">
            {dark ? <Moon className="size-3.5 text-azure" aria-hidden /> : <Sun className="size-3.5 text-orange" aria-hidden />}
          </motion.span>
        </AnimatePresence>
      </motion.span>
    </button>
  );
}
