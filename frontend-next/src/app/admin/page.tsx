"use client";

import { ErrorState, ListSkeleton } from "@/components/states/states";
import { BarChart, PageHead, Panel, StatusBadge } from "@/components/admin/bits";
import { SeatDot } from "@/components/presence/seat-avatar";
import { useAdmin } from "@/hooks/use-admin";
import { Skeleton } from "@/components/ui/skeleton";

const fmt = new Intl.NumberFormat("en-US");

export default function AdminOverview() {
  const a = useAdmin();
  if (a.status === "error") return <ErrorState title="Admin data didn't load" error={a.error} onRetry={a.reload} />;
  const ready = a.status === "ready";
  const d = ready ? a.data : null;
  return (
    <>
      <PageHead title="Overview" body="Service health and Council usage for the last 14 days." />
      <section aria-label="Service health" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {!d && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}
        {d?.health.map((h) => (
          <div key={h.id} className="rounded-xl border border-border bg-panel p-4">
            <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-medium text-ink">{h.name}</h3></div>
            <div className="mt-2"><StatusBadge status={h.status} /></div>
            <p className="mt-3 text-xs text-ink-2">{h.detail}</p>
            <p className="text-xs text-ink-3">{h.uptime} uptime, 30 days</p>
          </div>
        ))}
      </section>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Requests per day" className="xl:col-span-2">
          <div className="p-4">{d ? <BarChart values={d.usage.map((u) => u.requests)} label="Requests per day over 14 days" format={fmt.format} /> : <Skeleton className="h-48" />}
            {d && <p className="mt-2 text-xs text-ink-3">Latest day: {fmt.format(d.usage[d.usage.length - 1].requests)} requests, {fmt.format(d.usage[d.usage.length - 1].tokensK)}k tokens.</p>}
          </div>
        </Panel>
        <Panel title="Usage by seat">
          {!d ? <div className="p-4"><ListSkeleton rows={6} /></div> : (
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink-3"><th className="px-4 py-2 font-medium">Seat</th><th className="px-2 py-2 text-right font-medium">Runs</th><th className="px-4 py-2 text-right font-medium">Cost</th></tr></thead>
              <tbody>{d.bySeat.map((s) => (
                <tr key={s.seat} className="border-t border-border"><td className="px-4 py-2"><span className="flex items-center gap-2 text-ink"><SeatDot seat={s.seatNo} />{s.seat}</span></td><td className="px-2 py-2 text-right font-mono text-xs text-ink-2">{fmt.format(s.runs)}</td><td className="px-4 py-2 text-right font-mono text-xs text-ink-2">${s.costUsd.toFixed(2)}</td></tr>
              ))}</tbody></table>
          )}
        </Panel>
      </div>
    </>
  );
}
