"use client";

import { FileText, PenTool, Sparkles, Star, Table2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states/states";
import { useRepo } from "@/hooks/use-repo";
import { usePageMeta } from "@/hooks/use-page-meta";
import { hrefFor, KIND_META } from "@/lib/nav";
import type { ItemKind, WorkItem } from "@/lib/data/types";
import { timeAgo } from "@/lib/utils";
import { useUi } from "@/stores/ui";

const QUICK: { kind: ItemKind; icon: React.ElementType; title: string; hint: string }[] = [
  { kind: "doc", icon: FileText, title: "New doc", hint: "Write with live cursors" },
  { kind: "sheet", icon: Table2, title: "New sheet", hint: "Formulas and typed columns" },
  { kind: "canvas", icon: PenTool, title: "New canvas", hint: "Sketch a flow or a system" },
  { kind: "council", icon: Sparkles, title: "Ask the Council", hint: "Get several views, one answer" },
];

function Row({ item }: { item: WorkItem }) {
  const Icon = KIND_META[item.kind].icon;
  return (
    <li>
      <Link href={hrefFor(item)} className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-md px-3 py-2.5 transition-colors hover:bg-raised sm:grid-cols-[1fr_9rem_7rem]">
        <span className="flex min-w-0 items-center gap-3"><Icon className="size-4 shrink-0 text-ink-3" aria-hidden /><span className="truncate text-sm font-medium text-ink">{item.title}</span>{item.starred && <Star className="size-3.5 shrink-0 fill-sun text-sun" aria-label="Starred" />}</span>
        <span className="hidden truncate text-sm text-ink-2 sm:block">{item.editedBy}</span>
        <span className="text-right text-sm text-ink-3">{timeAgo(item.editedAt)}</span>
      </Link>
    </li>
  );
}

export default function AppHome() {
  usePageMeta({ title: "Home", peers: [] });
  const router = useRouter();
  const workspaceId = useUi((s) => s.workspaceId);
  const items = useRepo(`items:${workspaceId}`, (r) => r.listItems(workspaceId));

  const start = (kind: ItemKind) => {
    if (kind === "council") return router.push("/app/council");
    toast("Creating files needs the backend. Opening a sample instead.");
    const sample = items.status === "ready" ? items.data.find((i) => i.kind === kind) : undefined;
    if (sample) router.push(hrefFor(sample));
  };

  return (
    <div className="page-x py-10">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">Welcome back, Priya</h2>
      <p className="mt-1 text-sm text-ink-2">Pick up a file or start something new.</p>

      <div className="mt-8 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {QUICK.map((q) => (
          <button key={q.title} type="button" onClick={() => start(q.kind)}
            className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3 text-left transition-colors hover:border-azure">
            <q.icon className="size-5 shrink-0 text-azure" aria-hidden />
            <span><span className="block text-sm font-medium text-ink">{q.title}</span><span className="block text-xs text-ink-3">{q.hint}</span></span>
          </button>
        ))}
      </div>

      <section className="mt-12" aria-labelledby="recent-h">
        <h2 id="recent-h" className="mb-2 px-3 text-xs font-medium text-ink-3">Recent</h2>
        {items.status === "loading" && <ListSkeleton rows={6} />}
        {items.status === "error" && <ErrorState title="Your files didn't load" error={items.error} onRetry={items.reload} />}
        {items.status === "ready" && items.data.length === 0 && <EmptyState icon={FileText} title="Nothing here yet" body="Create a doc, sheet or canvas, or ask the Council a question to get started." />}
        {items.status === "ready" && items.data.length > 0 && (
          <ul>{[...items.data].sort((a, b) => +new Date(b.editedAt) - +new Date(a.editedAt)).map((i) => <Row key={i.id} item={i} />)}</ul>
        )}
      </section>
    </div>
  );
}
