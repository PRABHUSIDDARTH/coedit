"use client";

import { useCallback, useRef, useState } from "react";
import { getCouncilClient } from "@/lib/data";
import type { Seat } from "@/lib/council/types";

export type SeatRun = { status: "waiting" | "speaking" | "done"; text: string };
export type CouncilPhase = "idle" | "discussing" | "synthesizing" | "done" | "error";

export interface CouncilState {
  phase: CouncilPhase;
  prompt: string;
  seats: Seat[];
  runs: Record<string, SeatRun>;
  answer: string;
  error?: string;
}

const IDLE: CouncilState = { phase: "idle", prompt: "", seats: [], runs: {}, answer: "" };

export function useCouncil() {
  const [state, setState] = useState<CouncilState>(IDLE);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (prompt: string, seats: Seat[]) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setState({
      phase: "discussing", prompt, seats, answer: "",
      runs: Object.fromEntries(seats.map((s) => [s.id, { status: "waiting", text: "" } as SeatRun])),
    });
    try {
      for await (const e of getCouncilClient().runCouncil({ prompt, seats, signal: ctl.signal })) {
        if (ctl.signal.aborted) return;
        setState((s) => {
          switch (e.type) {
            case "seat-start": return { ...s, runs: { ...s.runs, [e.seatId]: { ...s.runs[e.seatId], status: "speaking" } } };
            case "delta": return { ...s, runs: { ...s.runs, [e.seatId]: { ...s.runs[e.seatId], text: s.runs[e.seatId].text + e.delta } } };
            case "seat-done": return { ...s, runs: { ...s.runs, [e.seatId]: { ...s.runs[e.seatId], status: "done" } } };
            case "synthesis-start": return { ...s, phase: "synthesizing" };
            case "synthesis-delta": return { ...s, answer: s.answer + e.delta };
            case "done": return { ...s, phase: "done", answer: e.answer };
          }
        });
      }
    } catch (err) {
      if (!ctl.signal.aborted) setState((s) => ({ ...s, phase: "error", error: err instanceof Error ? err.message : "The council could not finish." }));
    }
  }, []);

  const cancel = useCallback(() => { abort.current?.abort(); setState((s) => (s.phase === "done" ? s : { ...s, phase: "idle" })); }, []);
  const reset = useCallback(() => { abort.current?.abort(); setState(IDLE); }, []);

  return { state, run, cancel, reset };
}
