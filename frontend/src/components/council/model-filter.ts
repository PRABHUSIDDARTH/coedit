/** Ids that look like embeddings, rerankers, safety/guard models, parsers or speech: not chat models. */
const NON_CHAT = /embed|rerank|retriev|guard|parse|safety|moderat|(^|[/_.-])bge([/_.-]|$)|whisper|(^|[/_.-])tts([/_.-]|$)/i;

export const looksNonChat = (id: string): boolean => NON_CHAT.test(id);

/** Case-insensitive substring match; every whitespace-separated word must appear. */
export function filterModels(models: string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? models.filter((m) => words.every((w) => m.toLowerCase().includes(w))) : models;
}

/** Split a loaded list into what to offer and how many were hidden as probably-not-chat. */
export function visibleModels(models: string[], showAll: boolean): { shown: string[]; hidden: number } {
  if (showAll) return { shown: models, hidden: 0 };
  const shown = models.filter((m) => !looksNonChat(m));
  return { shown, hidden: models.length - shown.length };
}
