import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS = {
  ok: { label: "Operational", icon: CheckCircle2, cls: "bg-success/15 text-success" },
  degraded: { label: "Degraded", icon: AlertTriangle, cls: "bg-warning/20 text-warning" },
  down: { label: "Down", icon: XCircle, cls: "bg-danger/15 text-danger" },
} as const;

/** Status is never color alone: it always has an icon and a word. */
export function StatusBadge({ status }: { status: keyof typeof STATUS }) {
  const s = STATUS[status];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", s.cls)}><s.icon className="size-3.5" aria-hidden />{s.label}</span>;
}

export function PageHead({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="font-display text-xl font-semibold tracking-tight text-ink">{title}</h2><p className="mt-1 text-sm text-ink-2">{body}</p></div>
      {action}
    </div>
  );
}

export function Panel({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-panel", className)} aria-label={title}>
      {title && <h3 className="border-b border-border px-4 py-3 text-sm font-medium text-ink">{title}</h3>}
      {children}
    </section>
  );
}

export function BarChart({ values, label, format = (n: number) => String(n) }: { values: number[]; label: string; format?: (n: number) => string }) {
  const max = Math.max(...values) * 1.1;
  const w = 100 / values.length;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-48 w-full" role="img" aria-label={label}>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={40 - g * 40} y2={40 - g * 40} stroke="var(--border)" strokeWidth="0.15" vectorEffect="non-scaling-stroke" />)}
      {values.map((v, i) => (
        <rect key={i} x={i * w + w * 0.18} width={w * 0.64} y={40 - (v / max) * 40} height={(v / max) * 40} rx="0.6" fill="var(--azure)" opacity={i === values.length - 1 ? 1 : 0.75}>
          <title>{`Day ${i + 1}: ${format(v)}`}</title>
        </rect>
      ))}
    </svg>
  );
}
