import type { CouncilClient, CouncilEvent, CouncilRequest, Seat } from "@/lib/council/types";
import { SEATS, SEAT_TAKES, SYNTHESIS_PARTS } from "./seats";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

const topicOf = (prompt: string) => {
  const t = prompt.trim().replace(/\s+/g, " ");
  return t.length > 70 ? `“${t.slice(0, 67)}…”` : `“${t}”`;
};

/** Streams canned, seat-specific text with realistic pacing: seats speak in turns of a few words,
 *  so the discussion reads as interleaved, then a synthesis streams in. */
export class MockCouncilClient implements CouncilClient {
  async listSeats(): Promise<Seat[]> {
    await sleep(350);
    return SEATS;
  }

  async *runCouncil({ prompt, seats, signal }: CouncilRequest): AsyncIterable<CouncilEvent> {
    const topic = topicOf(prompt);
    const script = seats.map((s) => ({
      seat: s,
      words: (SEAT_TAKES[s.id] ?? SEAT_TAKES.analyst).join(" ").replaceAll("{topic}", topic).split(" "),
      cursor: 0,
      started: false,
    }));

    await sleep(500, signal);
    while (script.some((s) => s.cursor < s.words.length)) {
      for (const s of script) {
        if (signal?.aborted) return;
        if (s.cursor >= s.words.length) continue;
        if (!s.started) { s.started = true; yield { type: "seat-start", seatId: s.seat.id }; }
        const n = 2 + Math.floor(Math.random() * 3);
        const chunk = s.words.slice(s.cursor, s.cursor + n).join(" ") + " ";
        s.cursor += n;
        yield { type: "delta", seatId: s.seat.id, delta: chunk };
        if (s.cursor >= s.words.length) yield { type: "seat-done", seatId: s.seat.id };
        await sleep(55 + Math.random() * 70, signal);
      }
    }

    yield { type: "synthesis-start" };
    await sleep(700, signal);
    const answer = buildAnswer(seats.length);
    for (const piece of answer.match(/\S+\s*/g) ?? []) {
      if (signal?.aborted) return;
      yield { type: "synthesis-delta", delta: piece };
      await sleep(22 + Math.random() * 22, signal);
    }
    yield { type: "done", answer };
  }
}

function buildAnswer(seatCount: number): string {
  const p = SYNTHESIS_PARTS;
  return [
    `Recommendation: ${p.summary}`,
    `Where the ${seatCount} seats agreed:\n${p.agreed.map((a) => `- ${a}`).join("\n")}`,
    `Where they split:\n${p.split.map((a) => `- ${a}`).join("\n")}`,
    `Next step: ${p.next}`,
  ].join("\n\n");
}
