"use client";

import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Calendar, ChevronDown, DollarSign, Hash, Percent, Plus, Tag, Type } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCollab } from "@/hooks/use-collab";
import { usePageMeta } from "@/hooks/use-page-meta";
import type { DocUpdate } from "@/lib/collab/types";
import type { ColumnType, SheetData } from "@/lib/data/types";
import { seatColor } from "@/lib/seats";
import { cn } from "@/lib/utils";
import { Calc, STATUS_TONE, address, colLetter, display, isNumeric } from "./calc";

const ME = { id: "u-priya", name: "Priya Nair", seat: 1 };
const TYPES: { type: ColumnType; label: string; icon: React.ElementType }[] = [
  { type: "text", label: "Text", icon: Type }, { type: "number", label: "Number", icon: Hash }, { type: "currency", label: "Currency", icon: DollarSign },
  { type: "percent", label: "Percent", icon: Percent }, { type: "date", label: "Date", icon: Calendar }, { type: "status", label: "Status", icon: Tag },
];
const TONE_CLASS = { success: "bg-success/15 text-success", info: "bg-info/15 text-info", warning: "bg-warning/20 text-warning", danger: "bg-danger/15 text-danger" } as const;
const col = createColumnHelper<number>();

export default function SheetEditor({ docId, sheet }: { docId: string; sheet: SheetData }) {
  const [raw, setRaw] = useState(sheet.rows);
  const [types, setTypes] = useState(sheet.columns.map((c) => c.type));
  const [sel, setSel] = useState({ row: 0, col: 0 });
  const [edit, setEdit] = useState<{ row: number; col: number; value: string } | null>(null);
  const [, bump] = useState(0);
  const calc = useMemo(() => new Calc(sheet.rows), [sheet]);
  const grid = useRef<HTMLDivElement>(null);
  const cellRef = useRef<HTMLInputElement>(null);
  // No cleanup: the engine holds no external resources, and destroying it in an effect breaks React's dev double-mount.

  const write = (row: number, c: number, value: string) => {
    calc.set(row, c, value);
    setRaw((r) => r.map((line, i) => (i === row ? line.map((v, j) => (j === c ? value : v)) : line)));
    bump((n) => n + 1);
  };

  const notesCol = sheet.columns.findIndex((c) => c.id === "notes");
  const collab = useCollab(docId, "sheet", (u: DocUpdate) => {
    const p = u.payload as { op?: string; row?: number; text?: string };
    if (p.op === "set-note" && notesCol >= 0 && p.row !== undefined && p.row < raw.length && p.text) write(p.row, notesCol, p.text);
  });
  usePageMeta({ title: sheet.title, kind: "sheet", peers: [ME, ...collab.peers.map((p) => p.collaborator)] });

  const peerAt = (r: number, c: number) => collab.peers.find((p) => p.position?.kind === "sheet" && p.position.row === r && p.position.col === c);

  const columns = useMemo(() => sheet.columns.map((def, ci) => col.display({
    id: def.id, size: def.width,
    header: () => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex w-full items-center gap-1.5 text-left" aria-label={`${def.label}, ${types[ci]} column. Change type`}>
            <span className="font-mono text-[10px] text-ink-3">{colLetter(ci)}</span>
            <span className="truncate font-medium text-ink-2">{def.label}</span>
            <ChevronDown className="ml-auto size-3 shrink-0 text-ink-3" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuRadioGroup value={types[ci]} onValueChange={(v) => setTypes((t) => t.map((x, i) => (i === ci ? (v as ColumnType) : x)))}>
            {TYPES.map((t) => <DropdownMenuRadioItem key={t.type} value={t.type}><t.icon /> {t.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    cell: (ctx) => ctx.row.original as unknown as React.ReactNode, // rendered below
  })), [sheet.columns, types]);

  // TanStack Table returns unmemoizable functions; the React Compiler skips this component, which is fine.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: useMemo(() => raw.map((_, i) => i), [raw]), columns, getCoreRowModel: getCoreRowModel() });

  const commit = (move?: { dr: number; dc: number }) => {
    if (edit) write(edit.row, edit.col, edit.value);
    setEdit(null);
    if (move) setSel((s) => ({ row: Math.max(0, Math.min(raw.length - 1, s.row + move.dr)), col: Math.max(0, Math.min(sheet.columns.length - 1, s.col + move.dc)) }));
    requestAnimationFrame(() => grid.current?.focus());
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    if (edit) return;
    const move = (dr: number, dc: number) => { e.preventDefault(); setSel((s) => ({ row: Math.max(0, Math.min(raw.length - 1, s.row + dr)), col: Math.max(0, Math.min(sheet.columns.length - 1, s.col + dc)) })); };
    if (e.key === "ArrowDown") move(1, 0); else if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) move(0, 1); else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) move(0, -1);
    else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); setEdit({ ...sel, value: raw[sel.row][sel.col] }); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); write(sel.row, sel.col, ""); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { setEdit({ ...sel, value: e.key }); e.preventDefault(); }
  };
  useEffect(() => { if (edit) cellRef.current?.focus(); }, [edit?.row, edit?.col]); // eslint-disable-line react-hooks/exhaustive-deps

  const selRaw = raw[sel.row]?.[sel.col] ?? "";
  const isFormula = selRaw.startsWith("=");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-1.5">
        <span className="w-12 rounded border border-border bg-raised px-1.5 py-1 text-center font-mono text-xs text-ink-2" aria-label="Selected cell">{address(sel.row, sel.col)}</span>
        <span className={cn("font-mono text-xs", isFormula ? "text-azure" : "text-ink-3")} aria-hidden>fx</span>
        <input aria-label="Formula bar" className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 font-mono text-sm text-ink outline-none focus:border-ring"
          value={edit ? edit.value : selRaw}
          onFocus={() => !edit && setEdit({ ...sel, value: selRaw })}
          onChange={(e) => setEdit({ ...sel, value: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit({ dr: 1, dc: 0 }); } if (e.key === "Escape") { setEdit(null); grid.current?.focus(); } }}
          onBlur={() => edit && commit()} />
        <span className="hidden items-center gap-1.5 text-xs text-ink-3 sm:flex" role="status"><span aria-hidden className={cn("size-1.5 rounded-full", collab.state === "connected" ? "bg-success" : "bg-warning")} />{collab.state === "connected" ? "Live" : "Connecting…"}</span>
      </div>

      <div ref={grid} tabIndex={0} onKeyDown={onGridKey} role="grid" aria-label={`${sheet.title} spreadsheet`} aria-rowcount={raw.length + 1} aria-colcount={sheet.columns.length}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: table.getTotalSize() + 48 }}>
          <thead className="sticky top-0 z-20">
            <tr role="row">
              <th className="sticky left-0 z-30 h-8 w-12 border-b border-r border-border bg-raised" />
              {table.getHeaderGroups()[0].headers.map((h) => (
                <th key={h.id} role="columnheader" style={{ width: h.getSize() }} className="h-8 border-b border-r border-border bg-raised px-2 text-left text-xs font-normal">{flexRender(h.column.columnDef.header, h.getContext())}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const r = row.original as unknown as number;
              return (
                <tr key={row.id} role="row" aria-rowindex={r + 2}>
                  <th scope="row" className="sticky left-0 z-10 h-8 w-12 border-b border-r border-border bg-raised text-center font-mono text-[11px] font-normal text-ink-3">{r + 1}</th>
                  {sheet.columns.map((def, c) => {
                    const t = types[c];
                    const selected = sel.row === r && sel.col === c;
                    const editing = edit?.row === r && edit.col === c;
                    const peer = peerAt(r, c);
                    const v = calc.value(r, c);
                    const text = display(v, t);
                    const err = typeof v === "string" && v.startsWith("#");
                    return (
                      <td key={def.id} role="gridcell" aria-selected={selected} onMouseDown={() => { setSel({ row: r, col: c }); if (!editing) setEdit(null); }} onDoubleClick={() => setEdit({ row: r, col: c, value: raw[r][c] })}
                        style={{ width: sheet.columns[c].width, ...(selected ? { outline: `2px solid ${seatColor(ME.seat)}`, outlineOffset: -2 } : peer ? { outline: `2px solid ${seatColor(peer.collaborator.seat)}`, outlineOffset: -2 } : {}) }}
                        className={cn("relative h-8 max-w-0 truncate border-b border-r border-border bg-panel px-2", isNumeric(t) && "text-right font-mono text-[13px]", err && "text-danger")}>
                        {editing ? (
                          <input ref={cellRef} aria-label={`Edit ${address(r, c)}`} className={cn("absolute inset-0 z-10 w-full bg-panel px-2 font-mono text-[13px] text-ink outline-none", isNumeric(t) && "text-right")}
                            value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} onBlur={() => commit()}
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit({ dr: 1, dc: 0 }); } else if (e.key === "Tab") { e.preventDefault(); commit({ dr: 0, dc: e.shiftKey ? -1 : 1 }); } else if (e.key === "Escape") { setEdit(null); grid.current?.focus(); } }} />
                        ) : t === "status" && text ? (
                          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", TONE_CLASS[STATUS_TONE[text] ?? "info"])}>{text}</span>
                        ) : (
                          <span className={cn(r === raw.length - 1 && def.id === "plan" && "font-semibold")}>{text}</span>
                        )}
                        {peer && <span className="pointer-events-none absolute -top-px right-0 z-10 -translate-y-full rounded-sm px-1 text-[10px] font-medium leading-4 text-on-fill" style={{ background: seatColor(peer.collaborator.seat) }}>{peer.collaborator.name.split(" ")[0]}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="p-3"><Button variant="ghost" size="sm" onClick={() => { calc.addRow(sheet.columns.length); setRaw((r) => [...r, sheet.columns.map(() => "")]); toast("Row added"); }}><Plus /> Add row</Button></div>
      </div>
    </div>
  );
}
