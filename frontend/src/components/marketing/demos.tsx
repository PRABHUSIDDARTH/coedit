import { Check, Sparkles } from "lucide-react";
import { SeatAvatar } from "@/components/presence/seat-avatar";
import { cn } from "@/lib/utils";
import { seatColor } from "@/lib/seats";

/** Small, static product vignettes for the marketing page. They use the same tokens as the app. */

export function CursorTag({ name, seat, className }: { name: string; seat: number; className?: string }) {
  return (
    <span className={cn("pointer-events-none absolute z-10 flex flex-col items-start", className)} aria-hidden>
      <span className="h-5 w-0.5 motion-safe:animate-pulse" style={{ background: seatColor(seat) }} />
      <span className="-mt-px rounded-sm rounded-tl-none px-1.5 py-0.5 text-[11px] font-medium leading-none text-on-fill" style={{ background: seatColor(seat) }}>
        {name}
      </span>
    </span>
  );
}

export function Window({ title, children, className, right }: { title: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-panel shadow-sm", className)}>
      <div className="flex h-10 items-center justify-between border-b border-border bg-raised px-4">
        <span className="text-xs font-medium text-ink-2">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

export function DocDemo({ className }: { className?: string }) {
  return (
    <Window
      title="Q3 launch brief"
      className={className}
      right={<div className="flex -space-x-1.5"><SeatAvatar name="Priya Nair" seat={1} size={20} ring /><SeatAvatar name="Marcus Webb" seat={2} size={20} ring /><SeatAvatar name="Inés Duarte" seat={3} size={20} ring /></div>}
    >
      <div className="relative space-y-3 p-6 text-sm leading-relaxed text-ink-2">
        <h3 className="text-xl font-semibold tracking-tight text-ink">Goal</h3>
        <p>Move trial-to-paid conversion from 9% to 13% by the end of the quarter, without raising support load.</p>
        <p className="relative">
          We still need a <mark className="rounded-sm bg-warning/25 px-0.5 text-ink">written stop condition</mark> for the cohort release.
          <CursorTag name="Marcus" seat={2} className="left-[78%] top-4" />
        </p>
        <div className="relative rounded-lg border border-border bg-raised p-3 text-xs">
          <div className="mb-1 flex items-center gap-2 font-medium text-ink"><SeatAvatar name="Inés Duarte" seat={3} size={18} /> Inés Duarte</div>
          Can we say how many accounts would make us stop? Even a rough number helps.
        </div>
        <p className="relative">The billing sync is the most likely place to break.<CursorTag name="Inés" seat={3} className="left-[46%] top-3" /></p>
      </div>
    </Window>
  );
}

const CELLS: [string, string, string, string][] = [
  ["Team", "640", "$12", "$7,680"],
  ["Business", "210", "$29", "$6,090"],
  ["Enterprise", "24", "$210", "$5,040"],
];

export function SheetDemo({ className }: { className?: string }) {
  return (
    <Window title="Q3 revenue model" className={className}>
      <div className="relative">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 font-mono text-xs">
          <span className="rounded bg-raised px-1.5 py-0.5 text-ink-2">D2</span>
          <span className="text-ink-3">fx</span>
          <span className="text-ink">=B2*C2</span>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-raised text-left text-xs text-ink-3">
              {["Plan", "Seats", "Price", "MRR"].map((h, i) => <th key={h} className={cn("border-b border-r border-border px-3 py-1.5 font-medium", i > 0 && "text-right")}>{h}</th>)}
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {CELLS.map((row, r) => (
              <tr key={row[0]}>
                {row.map((c, i) => (
                  <td key={i} className={cn("relative border-b border-r border-border px-3 py-1.5", i > 0 && "text-right", i === 0 && "font-sans text-ink")}
                    style={r === 0 && i === 3 ? { outline: `2px solid ${seatColor(1)}`, outlineOffset: -2 } : r === 1 && i === 2 ? { outline: `2px solid ${seatColor(4)}`, outlineOffset: -2 } : undefined}>
                    {c}
                    {r === 1 && i === 2 && <span className="absolute -top-px right-0 translate-y-[-100%] rounded-sm px-1 text-[10px] font-medium text-on-fill" style={{ background: seatColor(4) }}>Kenji</span>}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="bg-raised font-semibold"><td className="border-r border-border px-3 py-1.5 font-sans text-ink">Total</td><td className="border-r border-border px-3 py-1.5 text-right">874</td><td className="border-r border-border" /><td className="px-3 py-1.5 text-right">$18,810</td></tr>
          </tbody>
        </table>
      </div>
    </Window>
  );
}

export function CanvasDemo({ className }: { className?: string }) {
  const nodes = [
    { x: 24, y: 70, label: "Sign up", seat: 1 }, { x: 150, y: 70, label: "Verify email", seat: 4 },
    { x: 276, y: 70, label: "Workspace", seat: 3 }, { x: 402, y: 20, label: "Invite team", seat: 2 }, { x: 402, y: 120, label: "First doc", seat: 5 },
  ];
  return (
    <Window title="Onboarding flow" className={className}>
      <svg viewBox="0 0 540 200" className="block w-full text-ink-3" role="img" aria-label="Onboarding flow diagram">
        {[[0, 1], [1, 2], [2, 3], [2, 4]].map(([a, b]) => (
          <line key={`${a}${b}`} x1={nodes[a].x + 104} y1={nodes[a].y + 22} x2={nodes[b].x} y2={nodes[b].y + 22} stroke="currentColor" strokeWidth="1.5" />
        ))}
        {nodes.map((n) => (
          <g key={n.label}>
            <rect x={n.x} y={n.y} width="104" height="44" rx="8" fill="var(--raised)" stroke={seatColor(n.seat)} strokeWidth="2" />
            <text x={n.x + 52} y={n.y + 26} textAnchor="middle" fontSize="12" fill="var(--text-1)" fontFamily="var(--font-inter)">{n.label}</text>
          </g>
        ))}
        <g transform="translate(470 150)"><path d="M0 0 L0 15 L4 11 L8 19 L11 18 L7 10 L12 10 Z" fill={seatColor(2)} /><rect x="14" y="12" width="40" height="16" rx="3" fill={seatColor(2)} /><text x="34" y="24" textAnchor="middle" fontSize="10" fontWeight="500" fill="var(--on-fill)" fontFamily="var(--font-inter)">Marcus</text></g>
      </svg>
    </Window>
  );
}

const SEAT_LINES = [
  { name: "Analyst", seat: 1, text: "The data supports the upside but not a promise. Show the estimate as a range." },
  { name: "Critic", seat: 2, text: "Nothing says what would make us stop. Add a kill criterion before kickoff." },
  { name: "Strategist", seat: 4, text: "A cohort release keeps every other option open and costs about two weeks." },
];

export function CouncilDemo({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="rounded-xl border border-border bg-panel p-4 text-sm text-ink-2">
        <span className="text-xs font-medium text-ink-3">Question</span>
        <p className="mt-1 text-ink">Should we ship the new pricing to everyone, or to a cohort first?</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {SEAT_LINES.map((s) => (
          <div key={s.name} className="rounded-xl border border-border bg-panel p-3 text-xs leading-relaxed text-ink-2">
            <div className="mb-2 flex items-center gap-2 font-medium text-ink"><SeatAvatar name={s.name} seat={s.seat} size={20} /> {s.name}</div>
            {s.text}
          </div>
        ))}
      </div>
      <div className="tidal-glow rounded-xl">
        <div className="relative rounded-xl border border-border bg-panel p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-ink"><Sparkles className="size-3.5 text-azure" aria-hidden /> Council answer</div>
          <p className="text-sm text-ink">Release to a small cohort first, with a written stop condition, and decide on the wider rollout after one review.</p>
          <ul className="mt-3 space-y-1.5 text-xs text-ink-2">
            {["Present the estimate as a range.", "Name an owner for the date and the rollback."].map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />{t}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
