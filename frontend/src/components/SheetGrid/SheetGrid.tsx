import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import type { CollabSession } from "../../lib/collab";
import { cellKey, COLS, columnName, ROWS, SheetEngine } from "../../lib/formula";
import { rowsToCsv } from "../../lib/csv";
import { downloadText, withExtension } from "../../lib/download";
import { takePendingImport } from "../../lib/pendingImport";
import { bindSheet, writeCell } from "../../lib/sheet";
import "./SheetGrid.css";

interface Pos {
  col: number;
  row: number;
}
interface Editing {
  key: string;
  draft: string;
  /** Where the caret is: in the cell itself or in the formula bar. */
  where: "cell" | "bar";
}
interface Peer {
  name: string;
  color: string;
}

const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max - 1);
const COL_INDEXES = Array.from({ length: COLS }, (_, i) => i);
const ROW_INDEXES = Array.from({ length: ROWS }, (_, i) => i);

export function SheetGrid({ session, name }: { session: CollabSession; name: string }) {
  const { doc, provider, readOnly, user } = session;
  const cells = useMemo(() => doc.getMap<string>("cells"), [doc]);
  // Raw inputs live in the shared map; the engine is this client's private calculator.
  const engine = useMemo(() => {
    const e = new SheetEngine();
    e.load(cells.entries());
    return e;
  }, [cells]);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const [selected, setSelected] = useState<Pos>({ col: 0, row: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [peers, setPeers] = useState<ReadonlyMap<string, Peer>>(new Map());
  const gridRef = useRef<HTMLDivElement>(null);
  const selectedKey = cellKey(selected.col, selected.row);

  useEffect(() => bindSheet(cells, engine, bump), [cells, engine]);

  // A just-imported .csv file: write its cells into the (new, empty) shared sheet once.
  useEffect(() => {
    if (readOnly) return;
    const imported = takePendingImport(session.fileId, "sheet");
    if (imported) doc.transact(() => imported.cells.forEach(([key, raw]) => writeCell(cells, key, raw)));
  }, [session, doc, cells, readOnly]);

  // Presence: publish my selected cell, show everyone else's.
  useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;
    const update = () => {
      const next = new Map<string, Peer>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return;
        const cell: unknown = state.cell;
        const who = state.user as Partial<Peer> | undefined;
        if (typeof cell === "string" && who?.name && who.color) {
          next.set(cell, { name: String(who.name), color: String(who.color) });
        }
      });
      setPeers(next);
    };
    awareness.on("change", update);
    update();
    return () => awareness.off("change", update);
  }, [provider]);

  useEffect(() => {
    provider.awareness?.setLocalStateField("user", user);
    provider.awareness?.setLocalStateField("cell", selectedKey);
  }, [provider, user, selectedKey]);

  useEffect(() => {
    gridRef.current
      ?.querySelector(`[data-key="${selectedKey}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedKey]);

  const shown = useMemo(() => {
    void version; // recompute whenever any cell changed
    return ROW_INDEXES.map((row) => COL_INDEXES.map((col) => engine.display(cellKey(col, row))));
  }, [engine, version]);

  const move = (dCol: number, dRow: number) =>
    setSelected((p) => ({ col: clamp(p.col + dCol, COLS), row: clamp(p.row + dRow, ROWS) }));

  function startEdit(draft: string, where: Editing["where"]) {
    if (!readOnly) setEditing({ key: selectedKey, draft, where });
  }

  function commit(dCol = 0, dRow = 0) {
    if (editing) writeCell(cells, editing.key, editing.draft);
    setEditing(null);
    move(dCol, dRow);
    gridRef.current?.focus();
  }

  function cancel() {
    setEditing(null);
    gridRef.current?.focus();
  }

  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    if (editing || e.ctrlKey || e.metaKey || e.altKey) return;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      Tab: [e.shiftKey ? -1 : 1, 0],
    };
    if (moves[e.key]) {
      e.preventDefault();
      move(...moves[e.key]);
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit(engine.raw(selectedKey), "cell");
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (!readOnly) writeCell(cells, selectedKey, "");
    } else if (e.key.length === 1) {
      e.preventDefault();
      startEdit(e.key, "cell"); // typing replaces the cell's content
    }
  }

  function onEditKey(e: KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit(0, e.shiftKey ? -1 : 1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit(e.shiftKey ? -1 : 1, 0);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  function selectCell(pos: Pos) {
    if (editing) writeCell(cells, editing.key, editing.draft);
    setEditing(null);
    setSelected(pos);
  }

  const setDraft = (draft: string) => setEditing((prev) => (prev ? { ...prev, draft } : prev));

  return (
    <div className="sheet">
      <div className="sheet-bar">
        <span className="sheet-ref" aria-label="Selected cell">
          {selectedKey}
        </span>
        <input
          className="sheet-formula"
          aria-label="Cell content"
          placeholder={readOnly ? "" : "Value or formula, e.g. =SUM(A1:A5)"}
          readOnly={readOnly}
          value={editing ? editing.draft : engine.raw(selectedKey)}
          onFocus={() => {
            if (!editing) startEdit(engine.raw(selectedKey), "bar");
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onEditKey}
          onBlur={() => {
            if (editing?.where === "bar") {
              writeCell(cells, editing.key, editing.draft);
              setEditing(null);
            }
          }}
        />
        <button
          type="button"
          className="ghost"
          title="Download the computed values as CSV"
          onClick={() =>
            downloadText(withExtension(name, ".csv"), `${rowsToCsv(engine.computedRows())}\r\n`, "text/csv")
          }
        >
          Export .csv
        </button>
      </div>
      <div className="sheet-scroll" ref={gridRef} tabIndex={0} onKeyDown={onGridKey}>
        <table className="sheet-table" role="grid" aria-rowcount={ROWS} aria-colcount={COLS}>
          <thead>
            <tr>
              <th className="corner" />
              {COL_INDEXES.map((col) => (
                <th key={col} scope="col" className={col === selected.col ? "on" : undefined}>
                  {columnName(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROW_INDEXES.map((row) => (
              <tr key={row}>
                <th scope="row" className={row === selected.row ? "on" : undefined}>
                  {row + 1}
                </th>
                {COL_INDEXES.map((col) => {
                  const key = cellKey(col, row);
                  const value = shown[row][col];
                  const isSelected = col === selected.col && row === selected.row;
                  const peer = peers.get(key);
                  const inCellEdit = editing?.key === key && editing.where === "cell";
                  const classes = [
                    isSelected && "selected",
                    value.startsWith("#") && value.length > 1 && "err",
                    value !== "" && !Number.isNaN(Number(value)) && "num",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td
                      key={col}
                      data-key={key}
                      role="gridcell"
                      aria-selected={isSelected}
                      className={classes || undefined}
                      style={peer ? { boxShadow: `inset 0 0 0 2px ${peer.color}` } : undefined}
                      title={peer ? `${peer.name} is here` : undefined}
                      onMouseDown={(e) => {
                        if (inCellEdit) return;
                        e.preventDefault(); // keep focus handling in one place
                        selectCell({ col, row });
                        gridRef.current?.focus();
                      }}
                      onDoubleClick={() => !inCellEdit && startEdit(engine.raw(key), "cell")}
                    >
                      {inCellEdit ? (
                        <input
                          autoFocus
                          className="sheet-cell-input"
                          aria-label={`Edit ${key}`}
                          value={editing.draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={onEditKey}
                          onBlur={() => {
                            writeCell(cells, key, editing.draft);
                            setEditing(null);
                          }}
                        />
                      ) : (
                        <>
                          {value}
                          {peer && (
                            <span className="sheet-peer" style={{ background: peer.color }}>
                              {peer.name}
                            </span>
                          )}
                        </>
                      )}
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
