"use client";

import { Check, Copy, FileText, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRepo } from "@/hooks/use-repo";
import type { CouncilState } from "@/hooks/use-council";
import { seatColor } from "@/lib/seats";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";

function Dots() {
  return <span className="inline-flex gap-0.5 align-middle" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="size-1 rounded-full bg-ink-3 motion-safe:animate-pulse" style={{ animationDelay: `${i * 160}ms` }} />)}</span>;
}

export function Discussion({ state }: { state: CouncilState }) {
  const router = useRouter();
  const workspaceId = useUi((s) => s.workspaceId);
  const setPending = useUi((s) => s.setPendingInsert);
  const docs = useRepo(`items:${workspaceId}`, (r) => r.listItems(workspaceId));
  const thinking = state.phase === "discussing" || state.phase === "synthesizing";
  const live = thinking ? "polite" : "off";

  const insertInto = (docId: string) => { setPending({ docId, text: state.answer }); router.push(`/app/doc/${docId}`); };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-panel p-4">
        <p className="text-xs font-medium text-ink-3">Question</p>
        <p className="mt-1 text-sm text-ink">{state.prompt}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-live={live}>
        {state.seats.map((s, i) => {
          const run = state.runs[s.id];
          const speaking = run?.status === "speaking";
          return (
            <article key={s.id} aria-label={`${s.name}'s view`} className={cn("rounded-xl border bg-panel p-4 transition-colors", speaking ? "" : "border-border")} style={speaking ? { borderColor: seatColor(i + 1) } : undefined}>
              <header className="mb-2 flex items-center gap-2.5">
                <SeatAvatar name={s.name} seat={i + 1} size={24} />
                <div className="min-w-0"><h3 className="text-sm font-medium text-ink">{s.name}</h3><p className="truncate text-xs text-ink-3">{s.role}</p></div>
                <span className="ml-auto text-xs text-ink-3">{run?.status === "done" ? <Check className="size-3.5 text-success" aria-label="Finished" /> : run?.status === "speaking" ? <Dots /> : "Waiting"}</span>
              </header>
              <p className="min-h-12 text-sm leading-relaxed text-ink-2">{run?.text || <span className="text-ink-3">Waiting for a turn…</span>}</p>
            </article>
          );
        })}
      </div>

      <div className={cn("rounded-xl", thinking && "tidal-glow")}>
        <section aria-label="Council answer" aria-live={live} className="relative rounded-xl border border-border bg-panel p-5">
          <header className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-azure" aria-hidden />
            <h3 className="text-sm font-semibold text-ink">Council answer</h3>
            {thinking && <span className="text-xs text-ink-3">{state.phase === "discussing" ? "Seats are discussing" : "Writing the answer"} <Dots /></span>}
          </header>
          {state.answer ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{state.answer}</p> : <p className="text-sm text-ink-3">The answer appears here once the seats have finished.</p>}
          {state.phase === "done" && (
            <footer className="mt-4 flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm"><FileText /> Insert into doc</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>Choose a doc</DropdownMenuLabel>
                  {docs.status === "ready" && docs.data.filter((d) => d.kind === "doc").map((d) => <DropdownMenuItem key={d.id} onSelect={() => insertInto(d.id)}><FileText /> {d.title}</DropdownMenuItem>)}
                  {docs.status === "loading" && <p className="px-2 py-1.5 text-sm text-ink-3">Loading docs…</p>}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(state.answer); toast.success("Answer copied"); }}><Copy /> Copy answer</Button>
            </footer>
          )}
        </section>
      </div>
    </div>
  );
}
