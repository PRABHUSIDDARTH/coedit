// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CustomSeats, type SeatDraft, newSeat } from "./custom-seats";
import { ModelCombobox } from "./model-combobox";
import { filterModels, looksNonChat, visibleModels } from "./model-filter";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const MODELS = ["meta/llama-3.1-70b-instruct", "meta/llama-3.1-8b-instruct", "qwen/qwen2.5-coder-32b-instruct", "nvidia/nv-embedqa-e5-v5", "nvidia/llama-3.2-nv-rerankqa-1b-v2", "meta/llama-guard-4-12b", "nvidia/nemoretriever-parse"];

function Harness({ models = MODELS, initial = "" }: { models?: string[]; initial?: string }) {
  const [v, setV] = useState(initial);
  return <><ModelCombobox id="m" value={v} onChange={setV} models={models} /><output data-testid="value">{v}</output></>;
}
const input = () => screen.getByRole("combobox") as HTMLInputElement;
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);

describe("filter helpers", () => {
  test("flags non-chat ids but not chat ids", () => {
    for (const id of ["nvidia/nv-embedqa-e5-v5", "nvidia/llama-3.2-nv-rerankqa-1b-v2", "meta/llama-guard-4-12b", "nvidia/nemoretriever-parse", "baai/bge-m3"]) expect(looksNonChat(id), id).toBe(true);
    for (const id of ["meta/llama-3.1-70b-instruct", "qwen/qwen2.5-coder-32b-instruct", "deepseek-ai/deepseek-r1"]) expect(looksNonChat(id), id).toBe(false);
  });
  test("filtering is case-insensitive and word-wise", () => {
    expect(filterModels(MODELS, "LLAMA 8b")).toEqual(["meta/llama-3.1-8b-instruct"]);
    expect(filterModels(MODELS, "")).toHaveLength(MODELS.length);
  });
  test("visibleModels counts hidden", () => {
    expect(visibleModels(MODELS, false).hidden).toBe(4);
    expect(visibleModels(MODELS, true)).toEqual({ shown: MODELS, hidden: 0 });
  });
});

describe("ModelCombobox", () => {
  test("opens on focus and lists chat models only, full ids", async () => {
    render(<Harness />);
    await userEvent.click(input());
    expect(options()).toEqual(MODELS.slice(0, 3));
    expect(screen.getByRole("option", { name: MODELS[0] }).getAttribute("title")).toBe(MODELS[0]);
  });
  test("filters as you type and keeps the text when nothing matches", async () => {
    render(<Harness />);
    await userEvent.click(input());
    await userEvent.type(input(), "qwen");
    expect(options()).toEqual(["qwen/qwen2.5-coder-32b-instruct"]);
    await userEvent.type(input(), "-zzz");
    expect(options()).toEqual([]);
    expect(screen.getByText(/No match/)).toBeTruthy();
    expect(screen.getByTestId("value").textContent).toBe("qwen-zzz");
  });
  test("keyboard: arrows move, Enter picks, Escape closes", async () => {
    render(<Harness />);
    await userEvent.click(input());
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { name: MODELS[1] }).getAttribute("aria-selected")).not.toBeNull();
    expect(input().getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: MODELS[1] }).id);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}"); // wraps to the last visible
    expect(input().getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: MODELS[2] }).id);
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("value").textContent).toBe(MODELS[2]);
    expect(options()).toEqual([]);
    await userEvent.keyboard("{ArrowDown}");
    expect(options().length).toBeGreaterThan(0);
    await userEvent.keyboard("{Escape}");
    expect(options()).toEqual([]);
  });
  test("clicking an option picks it; reopening shows the whole list again", async () => {
    render(<Harness initial={MODELS[0]} />);
    await userEvent.click(input());
    expect(options()).toHaveLength(3); // a chosen value does not filter the list
    await userEvent.click(screen.getByRole("option", { name: MODELS[1] }));
    expect(screen.getByTestId("value").textContent).toBe(MODELS[1]);
  });
  test("manual entry of an id that is not in the list survives Enter and blur", async () => {
    render(<Harness />);
    await userEvent.click(input());
    await userEvent.type(input(), "my/custom-model{Enter}");
    expect(screen.getByTestId("value").textContent).toBe("my/custom-model");
    await userEvent.tab();
    expect(screen.getByTestId("value").textContent).toBe("my/custom-model");
  });
  test("non-chat models are hidden with a note, shown by the toggle, and can be picked", async () => {
    render(<Harness />);
    await userEvent.click(input());
    expect(screen.getByText(/4 hidden: probably not chat models/)).toBeTruthy();
    expect(options()).not.toContain("nvidia/nv-embedqa-e5-v5");
    await userEvent.click(screen.getByLabelText("Show all models"));
    expect(options()).toEqual(MODELS);
    await userEvent.click(screen.getByRole("option", { name: "nvidia/nv-embedqa-e5-v5" }));
    expect(screen.getByTestId("value").textContent).toBe("nvidia/nv-embedqa-e5-v5");
  });
  test("with no models loaded there is no popover and typing works", async () => {
    render(<Harness models={[]} />);
    await userEvent.click(input());
    await userEvent.type(input(), "abc");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByTestId("value").textContent).toBe("abc");
  });
  test("the popover is rendered in document.body, outside the clipped card", async () => {
    const { container } = render(<div style={{ overflow: "hidden" }}><Harness /></div>);
    await userEvent.click(input());
    expect(container.querySelector("[role=listbox]")).toBeNull();
    expect(document.body.querySelector("[role=listbox]")).not.toBeNull();
  });
});

describe("seat panel states", () => {
  const presets = [{ id: "nvidia-nim", label: "NVIDIA NIM", base_url: "https://x/v1", needs_key: true }];
  const mount = (body: () => Response | Promise<Response>) => {
    vi.stubGlobal("fetch", async () => body());
    const Wrap = () => {
      const [seats, setSeats] = useState<SeatDraft[]>([{ ...newSeat(1), preset: "nvidia-nim", apiKey: "k" }]);
      return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><CustomSeats seats={seats} setSeats={setSeats} presets={presets} allowLocal={false} workspaceId="w" disabled={false} /></QueryClientProvider>;
    };
    render(<Wrap />);
  };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const load = () => userEvent.click(screen.getByText("Test & load models"));

  test("loading, then loaded N models (M hidden); picking works", async () => {
    let release!: (r: Response) => void;
    mount(() => new Promise<Response>((r) => { release = r; }));
    await load();
    expect(screen.getByText("Loading models…")).toBeTruthy();
    release(json({ ok: true, models: MODELS, source: "models", error: null }));
    await waitFor(() => screen.getByText("Loaded 7 models (4 hidden)."));
    await userEvent.click(screen.getByLabelText("Model"));
    await userEvent.click(within(screen.getByRole("listbox")).getByText(MODELS[0]));
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe(MODELS[0]);
  });
  test("empty list", async () => {
    mount(() => json({ ok: true, models: [], source: "models", error: null }));
    await load();
    await waitFor(() => screen.getByText(/listed no models/));
    await userEvent.type(screen.getByLabelText("Model"), "typed/id");
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("typed/id");
  });
  test("failed: shows the status code only", async () => {
    mount(() => json({ ok: false, models: [], source: "none", error: "The provider answered HTTP 401." }));
    await load();
    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByRole("alert").textContent).toBe("The provider answered HTTP 401.");
  });
  test("request failure surfaces an error", async () => {
    mount(() => json({ detail: "Seat: bad base URL" }, 422));
    await load();
    await waitFor(() => screen.getByRole("alert"));
  });
});
