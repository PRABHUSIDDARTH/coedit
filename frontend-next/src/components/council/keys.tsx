"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PROVIDER_LABEL, PROVIDERS, useCouncilConfig, useKeyChange, useKeys, type Provider, type ProviderMode } from "@/api/council";
import { SeatDot } from "@/components/presence/seat-avatar";
import { ErrorState, ListSkeleton } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const providerSeat = (p: Provider) => PROVIDERS.indexOf(p) + 1;
const MODE: Record<ProviderMode, { text: string; cls: string }> = {
  live: { text: "Live", cls: "bg-success/15 text-success" },
  demo: { text: "Demo: canned text", cls: "bg-warning/20 text-warning" },
  missing: { text: "Needs a key", cls: "bg-raised text-ink-3" },
};

function KeyRow({ provider, last4, mode, model }: { provider: Provider; last4?: string; mode?: ProviderMode; model?: string }) {
  const change = useKeyChange();
  const [value, setValue] = useState("");
  const fail = (e: Error) => toast.error(e.message);
  return (
    <li className="space-y-2 rounded-lg border border-border bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeatDot seat={providerSeat(provider)} /><span className="text-sm font-medium text-ink">{PROVIDER_LABEL[provider]}</span>
        {mode && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MODE[mode].cls}`}>{MODE[mode].text}</span>}
        <span className="ml-auto flex items-center gap-2">
          {last4 ? <code className="font-mono text-xs text-ink-2" title="Only the last four characters are ever shown">••••{last4}</code> : <span className="text-xs text-ink-3">No key saved</span>}
          {last4 && <Button variant="ghost" size="icon-xs" aria-label={`Remove the ${PROVIDER_LABEL[provider]} key`} disabled={change.isPending} onClick={() => change.mutate({ provider, apiKey: null }, { onSuccess: () => toast.success("Key removed"), onError: fail })}><Trash2 /></Button>}
        </span>
      </div>
      {model && mode === "live" && <p className="font-mono text-[11px] text-ink-3">{model}</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); change.mutate({ provider, apiKey: value }, { onSuccess: () => { setValue(""); toast.success(`${PROVIDER_LABEL[provider]} key saved`); }, onError: fail }); }}>
        <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={last4 ? "Replace the key" : "Paste an API key"} aria-label={`${PROVIDER_LABEL[provider]} API key`} className="h-8 min-w-0 flex-1" />
        <Button type="submit" size="sm" disabled={!value.trim() || change.isPending}>Save</Button>
      </form>
    </li>
  );
}

/** Your own provider keys. They are encrypted on the server and never sent back, only the last four characters. */
export function ProviderKeys() {
  const keys = useKeys();
  const config = useCouncilConfig();
  if (keys.isPending || config.isPending) return <ListSkeleton rows={3} />;
  if (keys.isError) return <ErrorState title="Keys didn't load" error={keys.error} onRetry={() => keys.refetch()} className="py-6" />;
  const last4 = new Map(keys.data.map((k) => [k.provider, k.last4]));
  const info = new Map(config.data?.providers.map((p) => [p.provider, p]));
  return (
    <ul className="space-y-2" aria-label="Provider keys">
      {PROVIDERS.map((p) => <KeyRow key={p} provider={p} last4={last4.get(p)} mode={info.get(p)?.mode} model={info.get(p)?.model} />)}
    </ul>
  );
}
