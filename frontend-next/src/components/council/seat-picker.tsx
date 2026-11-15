"use client";

import { Check } from "lucide-react";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import type { Seat } from "@/lib/council/types";
import { seatColor } from "@/lib/seats";
import { cn } from "@/lib/utils";

export const MIN_SEATS = 3;
export const MAX_SEATS = 6;

/** Seats take --seat-1..6 in the order they are chosen, so a seat's color is its position in `chosen`. */
export function SeatPicker({ seats, chosen, onChange, disabled }: { seats: Seat[]; chosen: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const toggle = (id: string) => {
    if (chosen.includes(id)) { if (chosen.length > MIN_SEATS) onChange(chosen.filter((c) => c !== id)); return; }
    if (chosen.length < MAX_SEATS) onChange([...chosen, id]);
  };
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-2 flex w-full items-baseline justify-between text-sm font-medium text-ink">
        Seats <span className="text-xs font-normal text-ink-3">{chosen.length} of {MAX_SEATS} · pick {MIN_SEATS} to {MAX_SEATS}</span>
      </legend>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {seats.map((s) => {
          const idx = chosen.indexOf(s.id);
          const on = idx >= 0;
          const locked = on && chosen.length <= MIN_SEATS;
          return (
            <li key={s.id}>
              <button type="button" role="checkbox" aria-checked={on} aria-label={`${s.name}, ${s.role}${locked ? ". At least three seats are required" : ""}`} onClick={() => toggle(s.id)}
                className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60", on ? "bg-panel" : "border-border bg-raised/40 hover:bg-raised")}
                style={on ? { borderColor: seatColor(idx + 1) } : undefined}>
                {on ? <SeatAvatar name={s.name} seat={idx + 1} size={28} /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-ink-3" aria-hidden>{s.name[0]}</span>}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">{s.name}{on && <Check className="size-3.5 text-success" aria-hidden />}</span>
                  <span className="block text-xs text-ink-2">{s.role}</span>
                  <span className="mt-1 block truncate font-mono text-[11px] text-ink-3">{s.model}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
