import { expect, test } from "vitest";
import { missingOptional } from "./outputs";

test("a pack without PRD.md reports it as not produced", () => {
  expect(missingOptional(["AGENTS.md", "ARCHITECTURE.md"])).toEqual(["PRD.md"]);
});
test("a full pack reports nothing", () => {
  expect(missingOptional(["AGENTS.md", "ARCHITECTURE.md", "PRD.md"])).toEqual([]);
});
