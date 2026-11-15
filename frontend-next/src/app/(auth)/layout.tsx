import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { CouncilDemo } from "@/components/marketing/demos";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Coedit home"><Logo height={26} /></Link>
          <ThemeToggle />
        </div>
        <main className="flex flex-1 items-center justify-center py-12">{children}</main>
      </div>
      <aside aria-hidden className="hidden flex-col justify-center border-l border-border bg-raised p-12 lg:flex">
        <div className="mx-auto w-full max-w-md">
          <p className="mb-6 font-display text-2xl font-semibold leading-snug tracking-tight text-ink">Ask once. Hear every side. Keep one answer.</p>
          <CouncilDemo />
        </div>
      </aside>
    </div>
  );
}
