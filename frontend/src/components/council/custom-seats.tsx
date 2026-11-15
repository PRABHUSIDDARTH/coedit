"use client";

import { CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { type Preset, type SeatRequest, useSeatModels } from "@/api/council";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MAX_SEATS = 5;
export const CUSTOM = "custom";

/** What the form holds for one seat. Prices stay strings so "" (not set yet) differs from "0" (free). */
export interface SeatDraft {
  id: string;
  preset: string; // a preset id or CUSTOM
  baseUrl: string;
  apiKey: string;
  model: string;
  priceIn: string;
  priceOut: string;
  tokenCap: number;
}

export const newSeat = (n: number): SeatDraft => ({ id: `seat-${n}`, preset: "groq", baseUrl: "", apiKey: "", model: "", priceIn: "", priceOut: "", tokenCap: 30_000 });

/** Why this seat cannot run yet, or null. A model without a price is refused, as on the server. */
export function seatProblem(seat: SeatDraft, presets: Preset[]): string | null {
  const preset = presets.find((p) => p.id === seat.preset);
  if (seat.preset === CUSTOM && !seat.baseUrl.trim()) return "Enter a base URL.";
  if (preset?.needs_key && !seat.apiKey.trim()) return `${preset.label} needs an API key.`;
  if (!seat.model.trim()) return "Pick or type a model.";
  if (seat.priceIn.trim() === "" || seat.priceOut.trim() === "" || Number(seat.priceIn) < 0 || Number(seat.priceOut) < 0) return "Set a price (0 for a free or local model).";
  if (!(seat.tokenCap > 0)) return "Set a token cap for this seat.";
  return null;
}

export const toRequest = (seat: SeatDraft): SeatRequest => ({
  id: seat.id,
  preset: seat.preset === CUSTOM ? null : seat.preset,
  base_url: seat.preset === CUSTOM ? seat.baseUrl.trim() : null,
  model: seat.model.trim(),
  price_in: seat.priceIn.trim(),
  price_out: seat.priceOut.trim(),
  token_cap: seat.tokenCap,
  api_key: seat.apiKey.trim() || null,
});

const field = "h-9 w-full rounded-lg border border-input bg-background px-2 text-sm font-normal";

function SeatRow({ seat, presets, workspaceId, disabled, onChange, onRemove }: { seat: SeatDraft; presets: Preset[]; workspaceId: string; disabled: boolean; onChange: (s: SeatDraft) => void; onRemove: () => void }) {
  const probe = useSeatModels(workspaceId);
  const [models, setModels] = useState<string[]>([]);
  const preset = presets.find((p) => p.id === seat.preset);
  const set = (patch: Partial<SeatDraft>) => onChange({ ...seat, ...patch });
  const load = () =>
    probe.mutate(
      { preset: seat.preset === CUSTOM ? null : seat.preset, base_url: seat.preset === CUSTOM ? seat.baseUrl.trim() : null, api_key: seat.apiKey.trim() || null },
      { onSuccess: (r) => setModels(r.models) },
    );
  const listId = `models-${seat.id}`;
  const problem = seatProblem(seat, presets);
  return (
    <li className="space-y-2 rounded-lg border border-border bg-panel p-3">
      <div className="flex items-center gap-2">
        <code className="font-mono text-xs text-ink-2">{seat.id}</code>
        <Button type="button" variant="ghost" size="icon-xs" className="ml-auto" aria-label={`Remove ${seat.id}`} disabled={disabled} onClick={onRemove}><Trash2 /></Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-ink">Provider
          <select value={seat.preset} disabled={disabled} onChange={(e) => { setModels([]); probe.reset(); set({ preset: e.target.value }); }} className={field}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            <option value={CUSTOM}>Other (base URL)…</option>
          </select>
        </label>
        {seat.preset === CUSTOM
          ? <label className="space-y-1 text-xs font-medium text-ink">Base URL<Input value={seat.baseUrl} disabled={disabled} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://host/v1" className="h-9" /></label>
          : <p className="self-end pb-2 font-mono text-[11px] text-ink-3 break-all">{preset?.base_url}</p>}
        <label className="space-y-1 text-xs font-medium text-ink">API key {preset && !preset.needs_key ? "(optional)" : ""}
          <Input type="password" autoComplete="off" value={seat.apiKey} disabled={disabled} onChange={(e) => set({ apiKey: e.target.value })} placeholder="Used for this run only, never stored" className="h-9" />
        </label>
        <div className="space-y-1 text-xs font-medium text-ink">
          <label htmlFor={`model-${seat.id}`}>Model</label>
          <div className="flex gap-1.5">
            <Input id={`model-${seat.id}`} list={listId} value={seat.model} disabled={disabled} onChange={(e) => set({ model: e.target.value })} placeholder={models.length ? "Choose a model" : "Type a model id"} className="h-9 min-w-0 flex-1 font-mono text-xs" />
            <datalist id={listId}>{models.map((m) => <option key={m} value={m} />)}</datalist>
            <Button type="button" size="sm" variant="outline" disabled={disabled || probe.isPending || (seat.preset === CUSTOM && !seat.baseUrl.trim())} onClick={load}>{probe.isPending ? "Testing…" : "Test & load models"}</Button>
          </div>
        </div>
      </div>
      {probe.isError && <p role="alert" className="flex items-center gap-1.5 text-xs text-danger"><XCircle className="size-3.5" aria-hidden />{probe.error.message}</p>}
      {probe.data && probe.data.ok && <p className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="size-3.5" aria-hidden />Connected: {probe.data.models.length} models{probe.data.source === "ollama-tags" ? " (Ollama list)" : ""}.</p>}
      {probe.data && !probe.data.ok && <p role="alert" className="flex items-center gap-1.5 text-xs text-warning"><XCircle className="size-3.5" aria-hidden />{probe.data.error}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-medium text-ink">Price in, $/M tokens<input type="number" min={0} step="any" value={seat.priceIn} disabled={disabled} onChange={(e) => set({ priceIn: e.target.value })} placeholder="0 = free" className={field} /></label>
        <label className="space-y-1 text-xs font-medium text-ink">Price out, $/M tokens<input type="number" min={0} step="any" value={seat.priceOut} disabled={disabled} onChange={(e) => set({ priceOut: e.target.value })} placeholder="0 = free" className={field} /></label>
        <label className="space-y-1 text-xs font-medium text-ink">Seat token cap<input type="number" min={1000} step={1000} value={seat.tokenCap} disabled={disabled} onChange={(e) => set({ tokenCap: Number(e.target.value) })} className={field} /></label>
      </div>
      {problem && <p className="text-xs text-ink-3">{problem}</p>}
    </li>
  );
}

/** OpenAI-compatible seats (Groq, NVIDIA NIM, Ollama, any /v1 endpoint). Keys are used for the run only. */
export function CustomSeats({ seats, setSeats, presets, allowLocal, workspaceId, disabled }: { seats: SeatDraft[]; setSeats: (s: SeatDraft[]) => void; presets: Preset[]; allowLocal: boolean; workspaceId: string; disabled: boolean }) {
  const nextId = () => { let n = 1; while (seats.some((s) => s.id === `seat-${n}`)) n++; return `seat-${n}`; };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-ink">OpenAI-compatible seats</h3>
        <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={disabled || seats.length >= MAX_SEATS} onClick={() => setSeats([...seats, { ...newSeat(1), id: nextId() }])}><Plus />Add seat</Button>
      </div>
      {seats.length > 0 && (
        <>
          <p className="text-xs text-ink-3">With seats added, the council is these seats plus any built-in provider you saved a key for. {allowLocal ? "This server allows local providers." : "Local addresses (Ollama on this machine) are blocked on this server: see the README, COUNCIL_ALLOW_LOCAL_PROVIDERS."}</p>
          <ul className="space-y-2" aria-label="OpenAI-compatible seats">
            {seats.map((s, i) => <SeatRow key={s.id} seat={s} presets={presets} workspaceId={workspaceId} disabled={disabled} onChange={(n) => setSeats(seats.map((x, j) => (j === i ? n : x)))} onRemove={() => setSeats(seats.filter((_, j) => j !== i))} />)}
          </ul>
        </>
      )}
    </div>
  );
}
