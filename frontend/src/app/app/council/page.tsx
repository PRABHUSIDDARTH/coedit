"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { isActive, PROVIDER_LABEL, PROVIDERS, useCouncilConfig, useRun, useRuns, useStartRun } from "@/api/council";
import type { Tree } from "@/api/workspaces";
import { CustomSeats, seatProblem, toRequest, type SeatDraft } from "@/components/council/custom-seats";
import { ProviderKeys } from "@/components/council/keys";
import { RunView } from "@/components/council/run-view";
import { EmptyState, ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useCurrentWorkspace } from "@/hooks/use-workspace";
import { timeAgo } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { useQueryClient } from "@tanstack/react-query";

/** "Specs / Drafts" style labels for the folder picker. */
function folderOptions(tree: Tree): { id: string; label: string }[] {
  const byId = new Map(tree.folders.map((f) => [f.id, f]));
  const label = (id: string): string => { const f = byId.get(id); return !f ? "" : f.parent_id ? `${label(f.parent_id)} / ${f.name}` : f.name; };
  return tree.folders.map((f) => ({ id: f.id, label: label(f.id) })).sort((a, b) => a.label.localeCompare(b.label));
}

const EXAMPLES = ["A shared shopping list app for housemates, with sign-in and per-person claims.", "An internal tool where support agents triage and tag customer emails.", "A booking page for a small clinic with reminders by email."];

export default function CouncilPage() {
  usePageMeta({ title: "AI Council", kind: "council", peers: [] });
  const qc = useQueryClient();
  const { current, tree } = useCurrentWorkspace();
  const config = useCouncilConfig();
  const runs = useRuns(current?.id ?? "");
  const start = useStartRun(current?.id ?? "");
  const seed = useUi((s) => s.councilSeed);
  const setSeed = useUi((s) => s.setCouncilSeed);
  const [brief, setBrief] = useState(() => useUi.getState().councilSeed);
  const [folderId, setFolderId] = useState("");
  const [synth, setSynth] = useState("anthropic");
  const [seats, setSeats] = useState<SeatDraft[]>([]);
  const [tokenCap, setTokenCap] = useState(60_000);
  const [costCap, setCostCap] = useState("1.00");
  const [pickedId, setPickedId] = useState<string | null>(null);

  useEffect(() => { if (seed) setSeed(""); }, [seed, setSeed]);

  const modes = new Map(config.data?.providers.map((p) => [p.provider, p.mode]));
  // With custom seats, built-in providers take part only with a key of their own (no demo seats).
  const usableNative = PROVIDERS.filter((p) => modes.get(p) && modes.get(p) !== "missing" && (seats.length === 0 || modes.get(p) === "live"));
  const usable: string[] = [...usableNative, ...seats.map((s) => s.id)];
  const synthChoice = usable.includes(synth) ? synth : usable[0];
  const seatIssue = seats.map((s) => seatProblem(s, config.data?.presets ?? [])).find((p) => p !== null) ?? null;
  const runId = pickedId ?? runs.data?.[0]?.id ?? null;
  const run = useRun(runId);
  const folders = useMemo(() => (tree.data ? folderOptions(tree.data) : []), [tree.data]);
  const isOwner = current?.role === "owner";
  const busy = start.isPending || (run.data ? isActive(run.data.status) : false);
  const anyDemo = usableNative.some((p) => modes.get(p) === "demo");

  // When a run finishes its files appear in the tree.
  const finalStatus = run.data && !isActive(run.data.status) ? run.data.status : null;
  useEffect(() => { if (finalStatus && current) void qc.invalidateQueries({ queryKey: ["tree", current.id] }); }, [finalStatus, qc, current]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!synthChoice) return;
    start.mutate({ brief: brief.trim(), output_folder_id: folderId || null, synth_provider: synthChoice, seats: seats.map(toRequest), token_cap: tokenCap, cost_cap_usd: costCap },
      { onSuccess: (created) => { setPickedId(created.id); toast.success("The Council is working"); }, onError: (err) => toast.error(err.message) });
  };

  if (!current) return <EmptyState icon={Sparkles} className="py-24" title="Pick a workspace first" body="The Council saves its files into a workspace folder." />;

  return (
    <div className="grid min-h-full xl:grid-cols-[minmax(22rem,30rem)_1fr]">
      <section aria-label="Ask the Council" className="space-y-6 border-b border-border p-5 xl:border-b-0 xl:border-r xl:p-6">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-ink">Ask the Council</h2>
          <p className="mt-1 text-sm text-ink-2">Describe what you want to build. Three models draft and critique each other, then one writes the handoff pack: AGENTS.md, ARCHITECTURE.md and PRD.md.</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="brief" className="text-sm font-medium text-ink">Brief</label>
            <Textarea id="brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={6} maxLength={8000} placeholder="What should be built, and for whom?" disabled={busy} />
            <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((x) => <button key={x} type="button" disabled={busy} onClick={() => setBrief(x)} className="rounded-full border border-border bg-raised px-2.5 py-1 text-xs text-ink-2 hover:text-ink disabled:opacity-50">{x.slice(0, 38)}…</button>)}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium text-ink">Writes the final
              <select value={synthChoice ?? ""} onChange={(e) => setSynth(e.target.value)} disabled={busy || usable.length === 0} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm font-normal">
                {usable.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p as keyof typeof PROVIDER_LABEL] ?? p}{modes.get(p as (typeof PROVIDERS)[number]) === "demo" ? " (demo)" : ""}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ink">Save into
              <select value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={busy} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm font-normal">
                <option value="">Workspace root</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ink">Token cap
              <input type="number" min={1000} max={config.data?.max_token_cap ?? 200000} step={1000} value={tokenCap} onChange={(e) => setTokenCap(Number(e.target.value))} disabled={busy} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm font-normal" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-ink">Spend cap (USD)
              <input type="number" min={0.01} max={Number(config.data?.max_cost_cap_usd ?? 5)} step={0.01} value={costCap} onChange={(e) => setCostCap(e.target.value)} disabled={busy} className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm font-normal" />
            </label>
          </div>
          <CustomSeats seats={seats} setSeats={setSeats} presets={config.data?.presets ?? []} allowLocal={config.data?.allow_local_providers ?? false} workspaceId={current.id} disabled={busy || !isOwner} />
          {seatIssue && <p role="status" className="text-sm text-warning">{seatIssue}</p>}
          <p className="text-xs text-ink-3">A run stops before any step that could pass either cap. Server maximum: {(config.data?.max_token_cap ?? 200000).toLocaleString()} tokens and ${Number(config.data?.max_cost_cap_usd ?? 5).toFixed(0)}.</p>
          {anyDemo && <p className="text-xs text-warning">Seats marked demo return canned text instead of calling a model.</p>}
          {!isOwner && <p className="text-sm text-ink-2">Only a workspace owner can start a run. You can still see the results.</p>}
          {usable.length === 0 && config.isSuccess && <p className="text-sm text-ink-2">Add at least one provider key below, or an OpenAI-compatible seat above, to start.</p>}
          <Button type="submit" className="h-10 w-full bg-tidal text-on-fill hover:opacity-90" disabled={busy || !isOwner || brief.trim().length < 3 || !synthChoice || seatIssue !== null}>{busy ? "Council is working…" : "Run the Council"}</Button>
        </form>

        <div>
          <h3 className="mb-2 text-sm font-medium text-ink">Your provider keys</h3>
          <ProviderKeys />
        </div>
      </section>

      <section aria-label="Run" className="min-w-0 space-y-6 p-5 xl:p-6">
        {runs.isError && <ErrorState title="Runs didn't load" error={runs.error} onRetry={() => runs.refetch()} />}
        {!runId && !runs.isPending && <EmptyState icon={Sparkles} className="py-24" title="No runs yet" body="Write a brief on the left and run the Council. You'll see each model's steps, tokens and spend as it goes." />}
        {run.isError && <ErrorState title="This run didn't load" error={run.error} onRetry={() => run.refetch()} />}
        {run.data && <RunView run={run.data} tree={tree.data} />}
        {runs.data && runs.data.length > 1 && (
          <div>
            <h3 className="mb-2 text-xs font-medium text-ink-3">Earlier runs</h3>
            <ul className="divide-y divide-border rounded-xl border border-border bg-panel">
              {runs.data.map((r) => (
                <li key={r.id}><button type="button" onClick={() => setPickedId(r.id)} aria-current={r.id === runId} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-raised aria-[current=true]:bg-raised">
                  <span className="font-medium capitalize text-ink">{r.status}</span><span className="text-ink-3">{timeAgo(r.created_at)}</span><span className="ml-auto font-mono text-xs text-ink-3">${Number(r.cost_usd).toFixed(4)}</span>
                </button></li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
