/** The AI Council contract. `MockCouncilClient` streams canned text today; a gateway-backed client
 *  will implement the same interface later. */

export interface Seat {
  id: string;
  name: string;
  role: string;
  /** What this seat is told to care about; shown in the picker. */
  brief: string;
  /** Model route label shown in the UI and the admin console (mock). */
  model: string;
}

export interface CouncilRequest {
  prompt: string;
  seats: Seat[];
  signal?: AbortSignal;
}

export type CouncilEvent =
  | { type: "seat-start"; seatId: string }
  | { type: "delta"; seatId: string; delta: string }
  | { type: "seat-done"; seatId: string }
  | { type: "synthesis-start" }
  | { type: "synthesis-delta"; delta: string }
  | { type: "done"; answer: string };

export interface CouncilClient {
  /** Yields every event in order; the last one is `done`. Throws on failure; aborts quietly on `signal`. */
  runCouncil(req: CouncilRequest): AsyncIterable<CouncilEvent>;
  listSeats(): Promise<Seat[]>;
}
