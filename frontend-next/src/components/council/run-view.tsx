"use client";

import { AlertTriangle, Check, FileText, Loader2 } from "lucide-react";
import Link from "next/link";
import { isActive, PROVIDER_LABEL, PROVIDERS, type Provider, type Run, type RunStep } from "@/api/council";
import type { Tree } from "@/api/workspaces";
import { providerSeat } from "@/components/council/keys";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import { cn } from "@/lib/utils";

const OUTPUT_NAMES = ["AGENTS.md", "ARCHITECTURE.md", "PRD.md"];
const STAGES = [{ key: "draft", label: "Drafts", active: "drafting" }, { key: "critique", label: "Critiques", active: "critiquing" }, { key: "synthesis", label: "Synthesis", active: "synthesizing" }] as const;
const STAGE_LABEL = { draft: "Draft", critique: "Critique", synthesis: "Synthesis" } as const;

function stageState(run: Run, i: number): "done" | "active" | "waiting" {
  if (run.status === "done") return "done";
  const order = ["queued", "drafting", "critiquing", "synthesizing"];
  const at = order.indexOf(run.status);
  if (at < 0) return run.steps.some((s) => s.stage === STAGES[i].key) ? "done" : "waiting"; // failed or capped: what actually ran
  return at - 1 === i ? "active" : at - 1 > i ? "done" : "waiting";
}

function Steps({ steps }: { steps: RunStep[] }) {
  if (steps.length === 0) return <p className="text-sm text-ink-3">Waiting for a turn…</p>;
  return (
    <ul className="space-y-2">
      {steps.map((s, i) => (
        <li key={i} className="rounded-md bg-raised p-2.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{STAGE_LABEL[s.stage]}</span>
            {s.ok ? <Check className="size-3.5 text-success" aria-label="Finished" /> : <AlertTriangle className="size-3.5 text-danger" aria-label="Failed" />}
            <span className="ml-auto font-mono text-[11px] text-ink-3">${Number(s.cost_usd).toFixed(4)}</span>
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-ink-3">{s.model} · {s.input_tokens.toLocaleString()} in, {s.output_tokens.toLocaleString()} out</p>
          {!s.ok && s.error && <p className="mt-1 text-xs text-danger">{s.error}</p>}
        </li>
      ))}
    </ul>
  );
}

export function RunView({ run, tree }: { run: Run; tree: Tree | undefined }) {
  const active = isActive(run.status);
  const outputs = run.status === "done" && tree
    ? OUTPUT_NAMES.map((name) => tree.files.filter((f) => f.kind === "blob" && f.name === name && f.folder_id === run.output_folder_id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]).filter((f) => f !== undefined)
    : [];
  const tokenShare = Math.min(100, Math.round((run.tokens_used / run.token_cap) * 100));
  const costShare = Math.min(100, Math.round((Number(run.cost_usd) / Number(run.cost_cap_usd)) * 100));

  return (
    <div className="space-y-4">
      <div className={cn("rounded-xl", active && "tidal-glow")}>
        <section aria-label="Run progress" className="rounded-xl border border-border bg-panel p-4">
          <ol className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-live="polite">
            {STAGES.map((s, i) => {
              const st = stageState(run, i);
              return (
                <li key={s.key} className="flex items-center gap-2 text-sm" aria-current={st === "active" ? "step" : undefined}>
                  {st === "done" ? <Check className="size-4 text-success" aria-hidden /> : st === "active" ? <Loader2 className="size-4 animate-spin text-azure motion-reduce:animate-none" aria-hidden /> : <span className="size-4 rounded-full border border-border" aria-hidden />}
                  <span className={cn(st === "waiting" ? "text-ink-3" : "font-medium text-ink")}>{s.label}</span>
                </li>
              );
            })}
            <li className="ml-auto text-sm">
              {run.status === "done" && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">Done</span>}
              {run.status === "capped" && <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning">Stopped at the cap</span>}
              {run.status === "failed" && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs font-medium text-danger">Failed</span>}
              {active && <span className="text-xs text-ink-3">{run.status === "queued" ? "Starting" : "Working"}…</span>}
            </li>
          </ol>
          {run.error && <p role="alert" className="mt-3 text-sm text-danger">{run.error}</p>}
          {run.status === "capped" && <p className="mt-3 text-sm text-ink-2">The run stopped before a step that could have gone over your cap. Whatever finished was saved.</p>}
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><dt className="flex justify-between text-xs text-ink-3"><span>Tokens</span><span>{run.tokens_used.toLocaleString()} / {run.token_cap.toLocaleString()}</span></dt><dd><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${tokenShare}% of the token cap`}><div className="h-full rounded-full bg-azure" style={{ width: `${tokenShare}%` }} /></div></dd></div>
            <div><dt className="flex justify-between text-xs text-ink-3"><span>Spend</span><span>${Number(run.cost_usd).toFixed(4)} / ${Number(run.cost_cap_usd).toFixed(2)}</span></dt><dd><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised" role="img" aria-label={`${costShare}% of the cost cap`}><div className="h-full rounded-full bg-azure" style={{ width: `${costShare}%` }} /></div></dd></div>
          </dl>
        </section>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {PROVIDERS.map((p: Provider) => (
          <article key={p} aria-label={`${PROVIDER_LABEL[p]} seat`} className="rounded-xl border border-border bg-panel p-4">
            <header className="mb-3 flex items-center gap-2.5"><SeatAvatar name={PROVIDER_LABEL[p]} seat={providerSeat(p)} size={24} /><h3 className="text-sm font-medium text-ink">{PROVIDER_LABEL[p]}</h3>{run.synth_provider === p && <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-2">Writes the final</span>}</header>
            <Steps steps={run.steps.filter((s) => s.provider === p)} />
          </article>
        ))}
      </div>

      {run.status === "done" && (
        <section aria-label="Output files" className="rounded-xl border border-border bg-panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-ink">Handoff pack</h3>
          {outputs.length === 0 ? <p className="text-sm text-ink-3">The files are saved in the output folder.</p> : (
            <ul className="space-y-1">{outputs.map((f) => <li key={f.id}><Link href={`/app/file/${f.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink hover:bg-raised"><FileText className="size-4 text-ink-3" aria-hidden />{f.name}</Link></li>)}</ul>
          )}
        </section>
      )}
    </div>
  );
}
