import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export type Provider = "anthropic" | "openai" | "google";
export type ProviderMode = "live" | "demo" | "missing";
export type RunStatus = "queued" | "drafting" | "critiquing" | "synthesizing" | "done" | "failed" | "capped";

export const PROVIDERS: Provider[] = ["anthropic", "openai", "google"];
export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};
const TERMINAL: RunStatus[] = ["done", "failed", "capped"];
export const isActive = (status: RunStatus) => !TERMINAL.includes(status);

export interface StoredKey {
  provider: Provider;
  last4: string;
}

export interface CouncilConfig {
  providers: { provider: Provider; mode: ProviderMode; model: string }[];
  max_token_cap: number;
  max_cost_cap_usd: string;
}

export interface RunStep {
  stage: "draft" | "critique" | "synthesis";
  provider: Provider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
  ok: boolean;
  error: string | null;
}

export interface Run {
  id: string;
  output_folder_id: string | null;
  synth_provider: Provider;
  status: RunStatus;
  token_cap: number;
  cost_cap_usd: string;
  tokens_used: number;
  cost_usd: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  steps: RunStep[];
}

export interface RunRequest {
  brief: string;
  output_folder_id: string | null;
  synth_provider: Provider;
  token_cap: number;
  cost_cap_usd: string;
}

export function useCouncilConfig() {
  return useQuery({ queryKey: ["council-config"], queryFn: () => api<CouncilConfig>("/council/config") });
}

export function useKeys() {
  return useQuery({ queryKey: ["keys"], queryFn: () => api<StoredKey[]>("/settings/keys") });
}

/** Save (`apiKey` set) or remove (`apiKey` null) the signed-in user's key for one provider. */
export function useKeyChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, apiKey }: { provider: Provider; apiKey: string | null }): Promise<unknown> =>
      apiKey === null
        ? api<void>(`/settings/keys/${provider}`, { method: "DELETE" })
        : api<StoredKey>(`/settings/keys/${provider}`, { method: "PUT", body: { api_key: apiKey } }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["keys"] });
      void qc.invalidateQueries({ queryKey: ["council-config"] });
    },
  });
}

export function useRuns(workspaceId: string) {
  return useQuery({
    queryKey: ["runs", workspaceId],
    queryFn: () => api<Run[]>(`/workspaces/${workspaceId}/council/runs`),
  });
}

/** One run with its steps; polls once a second until it reaches a final status. */
export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => api<Run>(`/council/runs/${runId}`),
    enabled: runId !== null,
    refetchInterval: (query) => (query.state.data && !isActive(query.state.data.status) ? false : 1000),
  });
}

export function useStartRun(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RunRequest) =>
      api<Run>(`/workspaces/${workspaceId}/council/runs`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["runs", workspaceId] }),
  });
}
