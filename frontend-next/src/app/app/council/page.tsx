"use client";

import { Loader2, Sparkles, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Discussion } from "@/components/council/discussion";
import { MAX_SEATS, MIN_SEATS, SeatPicker } from "@/components/council/seat-picker";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAsync } from "@/hooks/use-async";
import { useCouncil } from "@/hooks/use-council";
import { usePageMeta } from "@/hooks/use-page-meta";
import { getCouncilClient } from "@/lib/data";
import { useUi } from "@/stores/ui";

const EXAMPLES = ["Should we ship the new pricing to everyone, or to a cohort first?", "What is the biggest risk in our Q3 launch plan?", "How should we explain the Free to Team upgrade in one sentence?"];

export default function CouncilPage() {
  usePageMeta({ title: "AI Council", kind: "council", peers: [] });
  const seats = useAsync(() => getCouncilClient().listSeats(), "seats");
  const { state, run, cancel, reset } = useCouncil();
  const seed = useUi((s) => s.councilSeed);
  const setSeed = useUi((s) => s.setCouncilSeed);
  // A selection sent from a doc ("Ask Council") seeds the question once, on arrival.
  const [prompt, setPrompt] = useState(() => (useUi.getState().councilSeed ? `Give me a second opinion on this:\n\n${useUi.getState().councilSeed}` : ""));
  const [chosen, setChosen] = useState<string[]>(["analyst", "critic", "writer"]);

  useEffect(() => { if (seed) setSeed(""); }, [seed, setSeed]);

  const busy = state.phase === "discussing" || state.phase === "synthesizing";
  const canRun = prompt.trim().length > 2 && chosen.length >= MIN_SEATS && chosen.length <= MAX_SEATS && !busy && seats.status === "ready";
  const start = () => seats.status === "ready" && run(prompt.trim(), chosen.map((id) => seats.data.find((s) => s.id === id)!).filter(Boolean));

  return (
    <div className="grid min-h-full gap-0 xl:grid-cols-[minmax(22rem,28rem)_1fr]">
      <section aria-label="Ask the Council" className="space-y-6 border-b border-border p-5 xl:border-b-0 xl:border-r xl:p-6">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-ink">Ask the Council</h2>
          <p className="mt-1 text-sm text-ink-2">Pick the seats, ask a question. They discuss in turn, then hand back one answer.</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="q" className="text-sm font-medium text-ink">Your question</label>
          <Textarea id="q" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} placeholder="What do you want a second opinion on?" disabled={busy} />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => <button key={e} type="button" disabled={busy} onClick={() => setPrompt(e)} className="rounded-full border border-border bg-raised px-2.5 py-1 text-xs text-ink-2 transition-colors hover:text-ink disabled:opacity-50">{e.length > 42 ? `${e.slice(0, 40)}…` : e}</button>)}
          </div>
        </div>
        {seats.status === "loading" && <ListSkeleton rows={4} />}
        {seats.status === "error" && <ErrorState title="Seats didn't load" error={seats.error} onRetry={seats.reload} className="py-6" />}
        {seats.status === "ready" && <SeatPicker seats={seats.data} chosen={chosen} onChange={setChosen} disabled={busy} />}
        <div className="flex gap-2">
          {busy
            ? <Button variant="outline" className="h-10 flex-1" onClick={cancel}><Square /> Stop</Button>
            : <Button className="h-10 flex-1 bg-tidal text-on-fill hover:opacity-90" disabled={!canRun} onClick={start}>{state.phase === "done" ? "Run again" : "Run the Council"}</Button>}
          {state.phase !== "idle" && !busy && <Button variant="ghost" className="h-10" onClick={reset}>Clear</Button>}
        </div>
      </section>

      <section aria-label="Discussion" className="min-w-0 p-5 xl:p-6">
        {state.phase === "idle" && <EmptyState icon={Sparkles} className="py-24" title="No discussion yet" body="Ask a question on the left and run the Council. You will see each seat's view as it is written." />}
        {state.phase === "error" && <ErrorState title="The Council couldn't finish" error={new Error(state.error)} onRetry={() => start()} />}
        {state.phase !== "idle" && state.phase !== "error" && <Discussion state={state} />}
        {busy && <p className="sr-only" role="status"><Loader2 aria-hidden /> The Council is working</p>}
      </section>
    </div>
  );
}
