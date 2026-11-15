/** Collaborator cursors and AI Council seats take --seat-1..6 in order of assignment. */
export const SEAT_COUNT = 6;

export type SeatIndex = 1 | 2 | 3 | 4 | 5 | 6;

/** CSS value for a seat's fill. Pair with `var(--on-fill)` for text on top of it. */
export const seatColor = (n: number): string => `var(--seat-${((n - 1) % SEAT_COUNT) + 1})`;

export const seatIndex = (n: number): SeatIndex => ((((n - 1) % SEAT_COUNT) + 1) as SeatIndex);

/** A person's seat is derived from their id, so every client agrees on it without coordinating. */
export function seatForUser(id: string): SeatIndex {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % SEAT_COUNT) + 1) as SeatIndex;
}
