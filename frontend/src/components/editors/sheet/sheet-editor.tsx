"use client";

import { Calendar, ChevronDown, DollarSign, Download, Eye, Hash, Percent, Tag, Type } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMe } from "@/api/auth";
import { COLUMN_TYPES, type ColumnType } from "@/api/sheetTypes";
import type { FileEntry } from "@/api/workspaces";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { usePageMeta } from "@/hooks/use-page-meta";
import { usePeers } from "@/lib/collab/awareness";
import { useCollab, type CollabSession } from "@/lib/collab/session";
import { rowsToCsv } from "@/lib/csv";
import { downloadText, withExtension } from "@/lib/download";
import { cellKey, columnName, COLS, ROWS, SheetEngine } from "@/lib/formula";
import { takePendingImport } from "@/lib/pendingImport";
import { seatColor, seatForUser } from "@/lib/seats";
import { bindSheet, writeCell } from "@/lib/sheet";
import { cn } from "@/lib/utils";
import { formatCell, isNumeric, STATUS_TONE } from "./format";

const ICONS: Record<ColumnType, React.ElementType> = { text: Type, number: Hash, currency: DollarSign, percent: Percent, date: Calendar, status: Tag };
const TONE = { success: "bg-success/15 text-success", info: "bg-info/15 text-info", warning: "bg-warning/20 text-warning", danger: "bg-danger/15 text-danger" } as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

type Pos = { row: number; col: number };

function Surface({ session, file, synced, status }: { session: CollabSession; file: FileEntry; synced: boolean; status: string }) {
  const me = useMe().data!;
  const peers = usePeers(session.provider);
  const cells = useMemo(() => session.doc.getMap<string>("cells"), [session]);
  const typeMap = useMemo(() => session.doc.getMap<string>("columnTypes"), [session]);
  const engine = useMemo(() => new SheetEngine(), []); // no destroy: React's dev double-mount would break it

  // Keep the engine and the grid in step with the shared map; `version` re-renders on every change.
  const store = useMemo(() => {
    let version = 0;
    return {
      subscribe(cb: () => void) {
        const unbind = bindSheet(cells, engine, () => { version++; cb(); });
        const onType = () => { version++; cb(); };
        typeMap.observe(onType);
        version++; // the initial load happened inside bindSheet
        return () => { unbind(); typeMap.unobserve(onType); };
      },
      get: () => version,
    };
  }, [cells, typeMap, engine]);
  useSyncExternalStore(store.subscribe, store.get, () => 0);

  const [sel, setSel] = useState<Pos>({ row: 0, col: 0 });
  const [edit, setEdit] = useState<{ pos: Pos; value: string } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const cellInput = useRef<HTMLInputElement>(null);
  const readOnly = session.readOnly;
  const selKey = cellKey(sel.col, sel.row);

  useEffect(() => { session.provider.setAwarenessField("cell", selKey); }, [session, selKey]);
  usePageMeta({ title: file.name, kind: "sheet", peers: [{ id: me.id, name: me.display_name, seat: seatForUser(me.id) }, ...peers] });

  // An imported CSV is written once, into the empty sheet, by whoever opens the new file first.
  useEffect(() => {
    if (!synced || readOnly || cells.size > 0) return;
    const pending = takePendingImport(file.id, "sheet");
    if (pending) session.doc.transact(() => pending.cells.forEach(([k, v]) => writeCell(cells, k, v)));
  }, [synced, readOnly, cells, session, file.id]);

  const typeOf = (col: number): ColumnType => (COLUMN_TYPES as string[]).includes(typeMap.get(columnName(col)) ?? "") ? (typeMap.get(columnName(col)) as ColumnType) : "text";
  const peerAt = (key: string) => peers.find((p) => p.cell === key);

  const move = (dr: number, dc: number) => setSel((s) => ({ row: Math.max(0, Math.min(ROWS - 1, s.row + dr)), col: Math.max(0, Math.min(COLS - 1, s.col + dc)) }));
  const commit = (to?: [number, number]) => {
    if (edit && !readOnly) writeCell(cells, cellKey(edit.pos.col, edit.pos.row), edit.value);
    setEdit(null);
    if (to) move(to[0], to[1]);
    requestAnimationFrame(() => grid.current?.focus());
  };
  const startEdit = (pos: Pos, value: string) => { if (!readOnly) setEdit({ pos, value }); };

  const onGridKey = (e: React.KeyboardEvent) => {
    if (edit) return;
    const go = (dr: number, dc: number) => { e.preventDefault(); move(dr, dc); };
    if (e.key === "ArrowDown") go(1, 0); else if (e.key === "ArrowUp") go(-1, 0);
    else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) go(0, 1); else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) go(0, -1);
    else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startEdit(sel, engine.raw(selKey)); }
    else if ((e.key === "Delete" || e.key === "Backspace") && !readOnly) { e.preventDefault(); writeCell(cells, selKey, ""); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); startEdit(sel, e.key); }
  };
  useEffect(() => { if (edit) cellInput.current?.focus(); }, [edit?.pos.row, edit?.pos.col]); // eslint-disable-line react-hooks/exhaustive-deps

  const selRaw = engine.raw(selKey);
  const live = status === "connected";
  const rows = useMemo(() => Array.from({ length: ROWS }, (_, i) => i), []);
  const colIdx = useMemo(() => Array.from({ length: COLS }, (_, i) => i), []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-1.5">
        <span className="w-12 rounded border border-border bg-raised px-1.5 py-1 text-center font-mono text-xs text-ink-2" aria-label="Selected cell">{selKey}</span>
        <span className={cn("font-mono text-xs", selRaw.startsWith("=") ? "text-azure" : "text-ink-3")} aria-hidden>fx</span>
        <input aria-label="Formula bar" readOnly={readOnly} className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 font-mono text-sm text-ink outline-none focus:border-ring"
          value={edit ? edit.value : selRaw}
          onFocus={() => !edit && startEdit(sel, selRaw)}
          onChange={(e) => setEdit({ pos: sel, value: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit([1, 0]); } if (e.key === "Escape") { setEdit(null); grid.current?.focus(); } }}
          onBlur={() => edit && commit()} />
        {readOnly && <span className="flex items-center gap-1.5 text-xs text-ink-2"><Eye className="size-3.5" aria-hidden /> View only</span>}
        <Button size="sm" variant="ghost" onClick={() => downloadText(withExtension(file.name, ".csv"), rowsToCsv(engine.computedRows()), "text/csv")}><Download /> Export .csv</Button>
        <span className="hidden items-center gap-1.5 text-xs text-ink-3 sm:flex" role="status"><span aria-hidden className={cn("size-1.5 rounded-full", live && synced ? "bg-success" : "bg-warning")} />{live ? (synced ? "Live" : "Loading…") : status === "connecting" ? "Connecting…" : "Offline"}</span>
      </div>

      <div ref={grid} tabIndex={0} onKeyDown={onGridKey} role="grid" aria-label={`${file.name} spreadsheet`} aria-rowcount={ROWS + 1} aria-colcount={COLS}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: COLS * 120 + 48 }}>
          <thead className="sticky top-0 z-20">
            <tr role="row">
              <th className="sticky left-0 z-30 h-8 w-12 border-b border-r border-border bg-raised" />
              {colIdx.map((c) => {
                const t = typeOf(c); const Icon = ICONS[t];
                return (
                  <th key={c} role="columnheader" className="h-8 min-w-[7.5rem] border-b border-r border-border bg-raised px-2 text-left text-xs font-normal">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild disabled={readOnly}>
                        <button type="button" className="flex w-full items-center gap-1.5 text-left disabled:cursor-default" aria-label={`Column ${columnName(c)}, ${t}${readOnly ? "" : ". Change type"}`}>
                          <span className="font-mono text-[11px] font-medium text-ink-2">{columnName(c)}</span>
                          {t !== "text" && <Icon className="size-3 text-ink-3" aria-hidden />}
                          {!readOnly && <ChevronDown className="ml-auto size-3 shrink-0 text-ink-3" aria-hidden />}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-40">
                        <DropdownMenuRadioGroup value={t} onValueChange={(v) => (v === "text" ? typeMap.delete(columnName(c)) : typeMap.set(columnName(c), v))}>
                          {COLUMN_TYPES.map((ct) => { const I = ICONS[ct]; return <DropdownMenuRadioItem key={ct} value={ct}><I /> {cap(ct)}</DropdownMenuRadioItem>; })}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r} role="row" aria-rowindex={r + 2}>
                <th scope="row" className="sticky left-0 z-10 h-8 w-12 border-b border-r border-border bg-raised text-center font-mono text-[11px] font-normal text-ink-3">{r + 1}</th>
                {colIdx.map((c) => {
                  const key = cellKey(c, r); const t = typeOf(c);
                  const selected = sel.row === r && sel.col === c; const editing = edit?.pos.row === r && edit.pos.col === c;
                  const peer = peerAt(key);
                  const shown = formatCell(engine.display(key), t);
                  const err = shown.startsWith("#");
                  return (
                    <td key={c} role="gridcell" aria-selected={selected} onMouseDown={() => { if (!editing) { if (edit) commit(); setSel({ row: r, col: c }); } }} onDoubleClick={() => startEdit({ row: r, col: c }, engine.raw(key))}
                      style={selected ? { outline: `2px solid ${seatColor(seatForUser(me.id))}`, outlineOffset: -2 } : peer ? { outline: `2px solid ${seatColor(peer.seat)}`, outlineOffset: -2 } : undefined}
                      className={cn("relative h-8 max-w-0 truncate border-b border-r border-border bg-panel px-2", isNumeric(t) && "text-right font-mono text-[13px]", err && "text-danger")}>
                      {editing ? (
                        <input ref={cellInput} aria-label={`Edit ${key}`} className={cn("absolute inset-0 z-10 w-full bg-panel px-2 font-mono text-[13px] text-ink outline-none", isNumeric(t) && "text-right")}
                          value={edit.value} onChange={(e) => setEdit({ pos: edit.pos, value: e.target.value })} onBlur={() => commit()}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit([1, 0]); } else if (e.key === "Tab") { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]); } else if (e.key === "Escape") { setEdit(null); grid.current?.focus(); } }} />
                      ) : t === "status" && shown ? (
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", TONE[STATUS_TONE[shown] ?? "info"])}>{shown}</span>
                      ) : shown}
                      {peer && <span className="pointer-events-none absolute -top-px right-0 z-10 -translate-y-full rounded-sm px-1 text-[10px] font-medium leading-4 text-on-fill" style={{ background: seatColor(peer.seat) }}>{peer.name.split(" ")[0]}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SheetEditor({ file }: { file: FileEntry }) {
  const collab = useCollab(file.id);
  usePageMeta(collab.session ? undefined : { title: file.name, kind: "sheet", peers: [] });
  if (collab.error) return <ErrorState title="This sheet didn't open" error={new Error(collab.error)} onRetry={() => location.reload()} />;
  if (!collab.session) return <div className="animate-pulse p-4" aria-busy="true" aria-label="Opening sheet"><div className="h-8 rounded bg-raised" /><div className="mt-2 space-y-1">{Array.from({ length: 9 }, (_, i) => <div key={i} className="h-8 rounded bg-raised/60" />)}</div></div>;
  return <Surface key={collab.session.fileId} session={collab.session} file={file} synced={collab.synced} status={collab.status} />;
}
