export const USAGE_DAYS = Array.from({ length: 14 }, (_, i) => {
  const wave = Math.sin(i / 2.2) * 120 + i * 18;
  return { day: i, requests: Math.round(760 + wave + (i % 3) * 40), tokensK: Math.round(1900 + wave * 4.1) };
});

export const USAGE_BY_SEAT = [
  { seat: "Analyst", seatNo: 1, runs: 412, tokensK: 5180, costUsd: 31.4 },
  { seat: "Critic", seatNo: 2, runs: 398, tokensK: 4720, costUsd: 22.9 },
  { seat: "Writer", seatNo: 3, runs: 377, tokensK: 3960, costUsd: 24.1 },
  { seat: "Strategist", seatNo: 4, runs: 301, tokensK: 3340, costUsd: 9.8 },
  { seat: "Researcher", seatNo: 5, runs: 214, tokensK: 2610, costUsd: 7.6 },
  { seat: "Operator", seatNo: 6, runs: 188, tokensK: 2170, costUsd: 10.5 },
];

export const ROUTING = [
  { seat: "Analyst", primary: "claude-sonnet-5-5", fallback: "gpt-6.1-terra", maxTokens: 4000, share: 100 },
  { seat: "Critic", primary: "gpt-6.1-terra", fallback: "claude-sonnet-5-5", maxTokens: 3000, share: 100 },
  { seat: "Writer", primary: "claude-sonnet-5-5", fallback: "gemini-3.8-flash", maxTokens: 4000, share: 100 },
  { seat: "Strategist", primary: "gemini-3.8-flash", fallback: "claude-sonnet-5-5", maxTokens: 3000, share: 80 },
  { seat: "Researcher", primary: "gemini-3.8-flash", fallback: "gpt-6.1-terra", maxTokens: 3000, share: 100 },
  { seat: "Operator", primary: "gpt-6.1-terra", fallback: "gemini-3.8-flash", maxTokens: 3000, share: 100 },
];

export const AUDIT = [
  { minutesAgo: 6, actor: "Priya Nair", action: "Started a council run", target: "Pricing tiers debate", level: "info" as const },
  { minutesAgo: 41, actor: "Marcus Webb", action: "Changed role", target: "Kenji Sato to Viewer", level: "warning" as const },
  { minutesAgo: 118, actor: "System", action: "Rotated signing key", target: "Realtime sync", level: "info" as const },
  { minutesAgo: 190, actor: "Inés Duarte", action: "Exported workspace", target: "Northwind Product", level: "info" as const },
  { minutesAgo: 340, actor: "System", action: "Fallback used", target: "Strategist, 3 calls", level: "warning" as const },
  { minutesAgo: 610, actor: "Priya Nair", action: "Revoked API key", target: "ending 4f2a", level: "danger" as const },
  { minutesAgo: 1250, actor: "Priya Nair", action: "Added API key", target: "ending 91c0", level: "info" as const },
  { minutesAgo: 1900, actor: "System", action: "Backup completed", target: "Postgres", level: "info" as const },
];

export const API_KEYS = [
  { id: "k1", provider: "Anthropic", last4: "91c0", created: "12 Nov", status: "active" as const },
  { id: "k2", provider: "OpenAI", last4: "7d3e", created: "12 Nov", status: "active" as const },
  { id: "k3", provider: "Google", last4: "b208", created: "3 Nov", status: "active" as const },
  { id: "k4", provider: "OpenAI", last4: "4f2a", created: "20 Oct", status: "revoked" as const },
];

export const HEALTH = [
  { id: "api", name: "API gateway", status: "ok" as const, detail: "p95 142 ms", uptime: "99.98%" },
  { id: "sync", name: "Realtime sync", status: "ok" as const, detail: "38 open sessions", uptime: "99.95%" },
  { id: "council", name: "Council workers", status: "degraded" as const, detail: "Strategist on fallback", uptime: "99.40%" },
  { id: "db", name: "Postgres", status: "ok" as const, detail: "11 ms replication lag", uptime: "100%" },
  { id: "blobs", name: "File storage", status: "ok" as const, detail: "41% of 200 GB", uptime: "99.99%" },
  { id: "mail", name: "Email delivery", status: "down" as const, detail: "Provider returned 503", uptime: "97.20%" },
];

export const ADMIN_SEED = {
  usage: USAGE_DAYS,
  bySeat: USAGE_BY_SEAT,
  routing: ROUTING,
  audit: AUDIT,
  keys: API_KEYS,
  health: HEALTH,
};
