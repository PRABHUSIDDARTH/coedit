"use client";

import { useState } from "react";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states/states";
import { PageHead, Panel } from "@/components/admin/bits";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdmin } from "@/hooks/use-admin";
import type { Level } from "@/lib/data/types";
import { cn, timeAgo } from "@/lib/utils";
import { ScrollText } from "lucide-react";

const TONE: Record<Level, string> = { info: "bg-info/15 text-info", warning: "bg-warning/20 text-warning", danger: "bg-danger/15 text-danger" };
const LABEL: Record<Level, string> = { info: "Info", warning: "Warning", danger: "Critical" };

export default function Audit() {
  const a = useAdmin();
  const [level, setLevel] = useState<"all" | Level>("all");
  if (a.status === "error") return <ErrorState title="The audit log didn't load" error={a.error} onRetry={a.reload} />;
  const rows = a.status === "ready" ? a.data.audit.filter((r) => level === "all" || r.level === level) : [];
  return (
    <>
      <PageHead title="Audit log" body="Who changed what, newest first." action={
        <Tabs value={level} onValueChange={(v) => setLevel(v as typeof level)}><TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="info">Info</TabsTrigger><TabsTrigger value="warning">Warning</TabsTrigger><TabsTrigger value="danger">Critical</TabsTrigger></TabsList></Tabs>} />
      <Panel>
        {a.status === "loading" ? <div className="p-4"><ListSkeleton rows={8} /></div> : rows.length === 0 ? <EmptyState icon={ScrollText} title="No events at this level" body="Choose another level to see more of the log." /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[36rem] text-sm">
            <thead><tr className="text-left text-xs text-ink-3"><th className="px-4 py-3 font-medium">When</th><th className="px-4 py-3 font-medium">Level</th><th className="px-4 py-3 font-medium">Who</th><th className="px-4 py-3 font-medium">Action</th><th className="px-4 py-3 font-medium">Target</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="whitespace-nowrap px-4 py-3 text-ink-3">{timeAgo(r.at)}</td>
                <td className="px-4 py-3"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", TONE[r.level])}>{LABEL[r.level]}</span></td>
                <td className="px-4 py-3 text-ink">{r.actor}</td><td className="px-4 py-3 text-ink-2">{r.action}</td><td className="px-4 py-3 text-ink-2">{r.target}</td>
              </tr>))}</tbody></table></div>
        )}
      </Panel>
    </>
  );
}
