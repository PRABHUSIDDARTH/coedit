"use client";

import { ErrorState, ListSkeleton } from "@/components/states/states";
import { PageHead, Panel } from "@/components/admin/bits";
import { SeatDot } from "@/components/presence/seat-avatar";
import { useAdmin } from "@/hooks/use-admin";

export default function Routing() {
  const a = useAdmin();
  if (a.status === "error") return <ErrorState title="Routing didn't load" error={a.error} onRetry={a.reload} />;
  return (
    <>
      <PageHead title="Seats and model routing" body="Which model answers for each seat, and what happens when it is unavailable." />
      <Panel>
        {a.status === "loading" ? <div className="p-4"><ListSkeleton rows={6} /></div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-sm">
            <thead><tr className="text-left text-xs text-ink-3"><th className="px-4 py-3 font-medium">Seat</th><th className="px-4 py-3 font-medium">Primary model</th><th className="px-4 py-3 font-medium">Fallback</th><th className="px-4 py-3 text-right font-medium">Max tokens</th><th className="px-4 py-3 font-medium">Traffic on primary</th></tr></thead>
            <tbody>{a.data.routing.map((r, i) => (
              <tr key={r.seat} className="border-t border-border">
                <td className="px-4 py-3"><span className="flex items-center gap-2 font-medium text-ink"><SeatDot seat={i + 1} />{r.seat}</span></td>
                <td className="px-4 py-3 font-mono text-xs text-ink">{r.primary}</td>
                <td className="px-4 py-3 font-mono text-xs text-ink-2">{r.fallback}</td>
                <td className="px-4 py-3 text-right font-mono text-xs text-ink-2">{r.maxTokens.toLocaleString("en-US")}</td>
                <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="h-1.5 w-28 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${r.share}% on primary`}><div className="h-full rounded-full bg-azure" style={{ width: `${r.share}%` }} /></div><span className="text-xs text-ink-2">{r.share}%</span></div></td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Panel>
    </>
  );
}
