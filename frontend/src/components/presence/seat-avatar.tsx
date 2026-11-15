import { cn } from "@/lib/utils";
import { seatColor } from "@/lib/seats";

const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

/** A person or council seat, colored by its seat. Text uses --on-fill to stay at 4.5:1. */
export function SeatAvatar({ name, seat, size = 28, ring, className }: { name: string; seat: number; size?: number; ring?: boolean; className?: string }) {
  return (
    <span
      title={name}
      aria-label={name}
      role="img"
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-on-fill", ring && "ring-2 ring-background", className)}
      style={{ width: size, height: size, background: seatColor(seat), fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 28 }: { people: { id: string; name: string; seat: number }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-2" role="group" aria-label={`${people.length} people here`}>
      {shown.map((p) => <SeatAvatar key={p.id} name={p.name} seat={p.seat} size={size} ring />)}
      {extra > 0 && (
        <span className="inline-flex items-center justify-center rounded-full bg-raised text-xs font-medium text-ink-2 ring-2 ring-background" style={{ width: size, height: size }}>+{extra}</span>
      )}
    </div>
  );
}

export function SeatDot({ seat, className }: { seat: number; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 rounded-full", className)} style={{ background: seatColor(seat) }} />;
}
