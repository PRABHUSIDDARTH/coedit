"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { filterModels, visibleModels } from "./model-filter";

export const MODEL_PLACEHOLDER = "Pick a model or type an id";

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  models: string[];
  disabled?: boolean;
}

/** Full-width model id input with a searchable list in a portal (never clipped by the card).
 *  Typing always works: an id that is not in the list is kept as typed. */
export function ModelCombobox({ id, value, onChange, models, disabled }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(""); // what was typed since opening; "" lists everything
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(-1);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const { shown, hidden } = visibleModels(models, showAll);
  const items = filterModels(shown, query);
  const canOpen = open && !disabled && models.length > 0;

  useLayoutEffect(() => {
    if (!canOpen) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [canOpen]);

  useEffect(() => {
    if (active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  const choose = (m: string) => { onChange(m); setQuery(""); setActive(-1); setOpen(false); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!models.length) return;
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!items.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + items.length) % items.length);
    } else if (e.key === "Enter") {
      if (canOpen && active >= 0 && items[active]) { e.preventDefault(); choose(items[active]); }
      else setOpen(false);
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); setOpen(false); setActive(-1); }
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={canOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={canOpen && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        title={value || undefined}
        placeholder={MODEL_PLACEHOLDER}
        className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-2 font-mono text-xs font-normal"
        onFocus={() => { setQuery(""); setOpen(true); }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => { onChange(e.target.value); setQuery(e.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {canOpen && rect && createPortal(
        // onMouseDown preventDefault keeps focus in the input, so a click on the list never blurs (and closes) it.
        <div style={{ position: "fixed", left: rect.left, top: rect.top, width: Math.max(rect.width, 280) }} className="z-[100] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg" onMouseDown={(e) => e.preventDefault()}>
          <ul id={listId} role="listbox" aria-label="Models" className="max-h-64 overflow-y-auto py-1">
            {items.map((m, i) => (
              <li key={m} id={`${listId}-${i}`} role="option" aria-selected={m === value} title={m} onClick={() => choose(m)} onMouseEnter={() => setActive(i)}
                className={`cursor-pointer truncate px-2 py-1 font-mono text-xs ${i === active ? "bg-accent text-accent-foreground" : ""} ${m === value ? "font-semibold" : ""}`}>{m}</li>
            ))}
            {!items.length && <li className="px-2 py-1.5 text-xs text-ink-3">No match. Your text is kept as the model id.</li>}
          </ul>
          {(hidden > 0 || showAll) && (
            <div className="space-y-1 border-t border-border px-2 py-1.5 text-[11px] text-ink-3">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Show all models</label>
              {!showAll && <p>{hidden} hidden: probably not chat models (embedding, rerank, guard, parse). You can still type any id.</p>}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
