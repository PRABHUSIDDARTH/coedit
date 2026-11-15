import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  isActive,
  PROVIDER_LABEL,
  PROVIDERS,
  useCouncilConfig,
  useKeyChange,
  useKeys,
  useRun,
  useRuns,
  useStartRun,
  type Provider,
  type ProviderMode,
  type Run,
} from "../../api/council";
import type { Tree } from "../../api/workspaces";
import "./CouncilPanel.css";

const MODE_TEXT: Record<ProviderMode, string> = {
  live: "live",
  demo: "demo — canned text",
  missing: "needs a key",
};
const OUTPUT_NAMES = ["AGENTS.md", "ARCHITECTURE.md", "PRD.md"];

/** "Specs / Drafts" style labels for the folder picker. */
function folderOptions(tree: Tree): { id: string; label: string }[] {
  const byId = new Map(tree.folders.map((f) => [f.id, f]));
  const label = (id: string): string => {
    const folder = byId.get(id);
    if (!folder) return "";
    return folder.parent_id ? `${label(folder.parent_id)} / ${folder.name}` : folder.name;
  };
  return tree.folders.map((f) => ({ id: f.id, label: label(f.id) })).sort((a, b) => a.label.localeCompare(b.label));
}

function KeyRow({ provider, last4, mode }: { provider: Provider; last4?: string; mode?: ProviderMode }) {
  const change = useKeyChange();
  const [value, setValue] = useState("");

  function save(e: FormEvent) {
    e.preventDefault();
    change.mutate({ provider, apiKey: value }, { onSuccess: () => setValue("") });
  }

  return (
    <li className="key-row">
      <div className="key-head">
        <b>{PROVIDER_LABEL[provider]}</b>
        {mode && <span className={`badge mode-${mode}`}>{MODE_TEXT[mode]}</span>}
        <span className="spacer" />
        {last4 ? <code title="Only the last four characters are kept readable">••••{last4}</code> : <span className="muted">no key</span>}
        {last4 && (
          <button
            className="icon"
            title="Remove this key"
            aria-label={`Remove ${PROVIDER_LABEL[provider]} key`}
            disabled={change.isPending}
            onClick={() => change.mutate({ provider, apiKey: null })}
          >
            ✕
          </button>
        )}
      </div>
      <form className="inline-form" onSubmit={save}>
        <input
          type="password"
          autoComplete="off"
          value={value}
          minLength={8}
          placeholder={last4 ? "Replace key…" : "Paste API key…"}
          aria-label={`${PROVIDER_LABEL[provider]} API key`}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="ghost" disabled={change.isPending || value.trim().length < 8}>
          Save
        </button>
      </form>
      {change.isError && (
        <p className="error" role="alert">
          {change.error.message}
        </p>
      )}
    </li>
  );
}

function RunView({ run, workspaceId, tree }: { run: Run; workspaceId: string; tree: Tree }) {
  const outputs =
    run.status === "done"
      ? OUTPUT_NAMES.map((name) =>
          tree.files
            .filter((f) => f.kind === "blob" && f.name === name && f.folder_id === run.output_folder_id)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0],
        ).filter((f) => f !== undefined)
      : [];
  const tokenShare = Math.min(100, Math.round((run.tokens_used / run.token_cap) * 100));
  return (
    <div className="run">
      <div className="run-head">
        <span className={`badge status-${run.status}`}>{run.status}</span>
        {isActive(run.status) && <span className="muted">working…</span>}
      </div>
      <div className="run-spend" aria-label="Spend">
        <div className="meter" role="progressbar" aria-valuenow={tokenShare} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${tokenShare}%` }} />
        </div>
        <span>
          {run.tokens_used.toLocaleString()} / {run.token_cap.toLocaleString()} tokens
        </span>
        <span>
          ${Number(run.cost_usd).toFixed(4)} / ${Number(run.cost_cap_usd).toFixed(2)}
        </span>
      </div>
      {run.status === "capped" && (
        <p className="muted">Stopped: the next stage would have gone over the cap. Completed steps are kept below.</p>
      )}
      {run.error && (
        <p className="error" role="alert">
          {run.error}
        </p>
      )}
      {run.steps.length > 0 && (
        <table className="steps">
          <tbody>
            {run.steps.map((s, i) => (
              <tr key={i} className={s.ok ? undefined : "failed"}>
                <td>{s.stage}</td>
                <td title={s.model}>{PROVIDER_LABEL[s.provider]}</td>
                <td className="num">{s.ok ? (s.input_tokens + s.output_tokens).toLocaleString() : "—"}</td>
                <td>{s.ok ? "ok" : `failed: ${s.error}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {outputs.length > 0 && (
        <p className="run-files">
          Written:{" "}
          {outputs.map((f) => (
            <Link key={f.id} to={`/w/${workspaceId}/f/${f.id}`}>
              {f.name}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}

export function CouncilPanel(props: { workspaceId: string; tree: Tree; onClose: () => void }) {
  const { workspaceId, tree } = props;
  const qc = useQueryClient();
  const config = useCouncilConfig();
  const keys = useKeys();
  const runs = useRuns(workspaceId);
  const start = useStartRun(workspaceId);
  const [brief, setBrief] = useState("");
  const [folderId, setFolderId] = useState("");
  const [synth, setSynth] = useState<Provider>("anthropic");
  const [tokenCap, setTokenCap] = useState(60_000);
  const [costCap, setCostCap] = useState("1.00");
  const [startedId, setStartedId] = useState<string | null>(null);

  const runId = startedId ?? runs.data?.[0]?.id ?? null;
  const run = useRun(runId);
  const folders = useMemo(() => folderOptions(tree), [tree]);
  const modes = new Map(config.data?.providers.map((p) => [p.provider, p.mode]));
  const usable = PROVIDERS.filter((p) => modes.get(p) && modes.get(p) !== "missing");
  const anyDemo = usable.some((p) => modes.get(p) === "demo");
  const busy = start.isPending || (run.data ? isActive(run.data.status) : false);

  // When a run finishes, its files appear in the tree.
  const finalStatus = run.data && !isActive(run.data.status) ? run.data.status : null;
  useEffect(() => {
    if (finalStatus) void qc.invalidateQueries({ queryKey: ["tree", workspaceId] });
  }, [finalStatus, qc, workspaceId]);

  function submit(e: FormEvent) {
    e.preventDefault();
    start.mutate(
      {
        brief,
        output_folder_id: folderId || null,
        synth_provider: usable.includes(synth) ? synth : usable[0],
        token_cap: tokenCap,
        cost_cap_usd: costCap,
      },
      { onSuccess: (created) => setStartedId(created.id) },
    );
  }

  return (
    <aside className="panel council" aria-label="AI council">
      <div className="panel-head">
        <h2>AI council</h2>
        <button className="ghost" onClick={props.onClose}>
          Close
        </button>
      </div>
      <p className="muted small">
        Three models draft a plan from your brief, critique each other once, and one writes AGENTS.md,
        ARCHITECTURE.md and PRD.md into a folder here.
      </p>

      <section>
        <h3>Your API keys</h3>
        <ul className="key-list">
          {PROVIDERS.map((p) => (
            <KeyRow key={p} provider={p} mode={modes.get(p)} last4={keys.data?.find((k) => k.provider === p)?.last4} />
          ))}
        </ul>
        <p className="muted small">
          Keys are encrypted on the server and never sent back to the browser.
          {anyDemo && " Providers marked demo return canned text instead of calling a model."}
        </p>
      </section>

      <section>
        <h3>New run</h3>
        <form className="run-form" onSubmit={submit}>
          <label>
            Brief
            <textarea
              required
              rows={5}
              maxLength={20000}
              value={brief}
              placeholder="What should be built, for whom, and any constraints…"
              onChange={(e) => setBrief(e.target.value)}
            />
          </label>
          <label>
            Save files to
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">Workspace root</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Final files written by
            <select value={usable.includes(synth) ? synth : (usable[0] ?? "")} onChange={(e) => setSynth(e.target.value as Provider)}>
              {usable.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                  {modes.get(p) === "demo" ? " (demo)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="caps">
            <label>
              Token cap
              <input
                type="number"
                min={1000}
                max={config.data?.max_token_cap ?? 200000}
                step={1000}
                value={tokenCap}
                onChange={(e) => setTokenCap(Number(e.target.value))}
              />
            </label>
            <label>
              Cost cap (USD)
              <input
                type="number"
                min={0.01}
                max={Number(config.data?.max_cost_cap_usd ?? 5)}
                step={0.01}
                value={costCap}
                onChange={(e) => setCostCap(e.target.value)}
              />
            </label>
          </div>
          <p className="muted small">
            A run stops before any stage that could exceed either cap. Server maximum:{" "}
            {(config.data?.max_token_cap ?? 200000).toLocaleString()} tokens / $
            {Number(config.data?.max_cost_cap_usd ?? 5).toFixed(0)}.
          </p>
          {usable.length === 0 && config.data && (
            <p className="muted">Add at least one provider API key above to start a run.</p>
          )}
          {start.isError && (
            <p className="error" role="alert">
              {start.error.message}
            </p>
          )}
          <button type="submit" disabled={busy || usable.length === 0 || !brief.trim()}>
            {busy ? "Running…" : "Start run"}
          </button>
        </form>
      </section>

      {run.data && (
        <section>
          <h3>{startedId ? "This run" : "Latest run"}</h3>
          <RunView run={run.data} workspaceId={workspaceId} tree={tree} />
        </section>
      )}
    </aside>
  );
}
