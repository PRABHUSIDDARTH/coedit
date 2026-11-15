import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const COLS = [
  { title: "Product", links: ["Docs", "Sheets", "Canvas", "AI Council", "Pricing"] },
  { title: "Company", links: ["About", "Changelog", "Careers", "Contact"] },
  { title: "Legal", links: ["Privacy", "Terms", "Security", "Data processing"] },
];

export function Footer() {
  return (
    <footer className="py-14">
      <div className="grid gap-10 px-4 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-5">
          <Logo height={26} />
          <p className="mt-4 max-w-xs text-sm text-ink-2">Docs, sheets and a canvas, with a Council that thinks it through with you.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-3 gap-6 md:col-span-7">
          {COLS.map((c) => (
            <div key={c.title}>
              <h3 className="text-sm font-semibold text-ink">{c.title}</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {c.links.map((l) => <li key={l}><Link href="#" className="text-ink-2 hover:text-ink">{l}</Link></li>)}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="page-x mt-12 border-t border-border pt-6 text-xs text-ink-3">© 2026 Coedit. All rights reserved.</div>
    </footer>
  );
}
