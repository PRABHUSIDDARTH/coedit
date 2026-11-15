import { describe, expect, it } from "vitest";
import { CUSTOM, newSeat, seatProblem, toRequest } from "./custom-seats";

const presets = [
  { id: "groq", label: "Groq", base_url: "https://api.groq.com/openai/v1", needs_key: true },
  { id: "ollama", label: "Ollama (local)", base_url: "http://host.docker.internal:11434/v1", needs_key: false },
];
const ready = { ...newSeat(1), apiKey: "k", model: "m", priceIn: "0", priceOut: "0" };

describe("seatProblem", () => {
  it("refuses a seat without a price, but accepts 0 (free / local)", () => {
    expect(seatProblem({ ...ready, priceIn: "" }, presets)).toMatch(/price/);
    expect(seatProblem({ ...ready, priceOut: "" }, presets)).toMatch(/price/);
    expect(seatProblem({ ...ready, priceIn: "-1" }, presets)).toMatch(/price/);
    expect(seatProblem(ready, presets)).toBeNull();
  });
  it("asks for a key only where the preset needs one", () => {
    expect(seatProblem({ ...ready, apiKey: "" }, presets)).toMatch(/needs an API key/);
    expect(seatProblem({ ...ready, preset: "ollama", apiKey: "" }, presets)).toBeNull();
  });
  it("needs a model, a base URL for custom seats and a token cap", () => {
    expect(seatProblem({ ...ready, model: " " }, presets)).toMatch(/model/);
    expect(seatProblem({ ...ready, preset: CUSTOM }, presets)).toMatch(/base URL/);
    expect(seatProblem({ ...ready, tokenCap: 0 }, presets)).toMatch(/token cap/);
  });
});

describe("toRequest", () => {
  it("sends a preset id or a base URL, trims, and keeps prices as strings", () => {
    expect(toRequest({ ...ready, apiKey: " k ", model: " m " })).toMatchObject({ preset: "groq", base_url: null, api_key: "k", model: "m", price_in: "0" });
    expect(toRequest({ ...ready, preset: CUSTOM, baseUrl: " http://h/v1 ", apiKey: "" })).toMatchObject({ preset: null, base_url: "http://h/v1", api_key: null });
  });
});
