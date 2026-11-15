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

export interface Preset {
  id: string;
  label: string;
  base_url: string;
  needs_key: boolean;
}

/** Display name of a seat: a built-in provider's label, or the id the user gave a custom seat. */
export const seatLabel = (id: string): string => PROVIDER_LABEL[id as Provider] ?? id;

export interface CouncilConfig {
  providers: { provider: Provider; mode: ProviderMode; model: string }[];
  presets: Preset[];
  allow_local_providers: boolean;
  max_token_cap: number;
  max_cost_cap_usd: string;
}

export interface RunStep {
  stage: "draft" | "critique" | "synthesis";
  provider: string; // a built-in provider or a custom seat id
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
  ok: boolean;
  error: string | null;
  scores: Record<string, number> | null;
}

export interface Run {
  id: string;
  output_folder_id: string | null;
  synth_provider: string;
  status: RunStatus;
  token_cap: number;
  cost_cap_usd: string;
  tokens_used: number;
  cost_usd: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  steps: RunStep[];
  /** One line per failed step, e.g. a critique whose scores could not be read. */
  report: string[];
}

/** An OpenAI-compatible seat as the API takes it. Prices are USD per million tokens (0 = free or local). */
export interface SeatRequest {
  id: string;
  preset: string | null;
  base_url: string | null;
  model: string;
  price_in: string;
  price_out: string;
  token_cap: number;
  api_key: string | null;
}

export interface ModelList {
  ok: boolean;
  models: string[];
  source: "models" | "ollama-tags" | "none";
  error: string | null;
}

export interface RunRequest {
  brief: string;
  output_folder_id: string | null;
  synth_provider: string;
  seats?: SeatRequest[];
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

/** Models a preset / base URL offers (`GET {base}/models`, Ollama's tag list as a fallback). Doubles as "Test connection". */
export function useSeatModels(workspaceId: string) {
  return useMutation({
    mutationFn: (body: { preset: string | null; base_url: string | null; api_key: string | null }) =>
      api<ModelList>(`/workspaces/${workspaceId}/council/models`, { method: "POST", body }),
  });
}
