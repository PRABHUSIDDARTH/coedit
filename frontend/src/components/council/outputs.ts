export const OUTPUT_NAMES = ["AGENTS.md", "ARCHITECTURE.md", "PRD.md"];
const OPTIONAL = ["PRD.md"];

/** Optional pack files the writing model did not emit. The run is still "done": PRD.md is optional. */
export const missingOptional = (savedNames: string[]): string[] => OPTIONAL.filter((n) => !savedNames.includes(n));
