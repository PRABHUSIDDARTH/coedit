import { Check } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PLANS = [
  { name: "Free", price: "$0", unit: "for up to 3 people", cta: "Start free", href: "/signup", featured: false,
    points: ["Unlimited docs, sheets and canvases", "30 days of version history", "20 Council runs a month"] },
  { name: "Team", price: "$12", unit: "per person, per month", cta: "Start a team trial", href: "/signup", featured: true,
    points: ["Everything in Free", "Unlimited version history", "Council with up to six seats", "Roles and share links"] },
  { name: "Business", price: "$29", unit: "per person, per month", cta: "Talk to sales", href: "/signup", featured: false,
    points: ["Everything in Team", "Single sign-on", "Audit log and admin console", "Bring your own model keys"] },
];

export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-h" className="scroll-mt-16 border-b border-border py-20 sm:py-28">
      <div className="page-x">
        <h2 id="pricing-h" className="font-display text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-4xl">Pay for the people, not the pages.</h2>
        <p className="mt-4 max-w-xl text-base text-ink-2">Every plan includes docs, sheets, canvas and the Council. Change plans or cancel from settings.</p>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <div key={p.name} className={cn("flex flex-col rounded-xl border bg-panel p-6", p.featured ? "border-azure" : "border-border")}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink">{p.name}</h3>
                {p.featured && <Badge className="bg-azure text-on-fill">Most teams</Badge>}
              </div>
              <p className="mt-4 flex items-baseline gap-2"><span className="font-display text-4xl font-semibold tracking-tight text-ink">{p.price}</span><span className="text-sm text-ink-3">{p.unit}</span></p>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-ink-2">
                {p.points.map((pt) => <li key={pt} className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{pt}</li>)}
              </ul>
              <Button asChild variant={p.featured ? "default" : "outline"} className="mt-8 h-10"><Link href={p.href}>{p.cta}</Link></Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
