"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ready"; data: T; error?: undefined }
  | { status: "error"; data?: undefined; error: Error };

type Settled<T> = { key: string; tick: number; result: Exclude<AsyncState<T>, { status: "loading" }> };

/** Runs `fn` on mount and whenever `key` changes. `reload` re-runs it. A result that belongs to an
 *  older key or attempt reads as loading, so there is no state reset inside the effect. */
export function useAsync<T>(fn: () => Promise<T>, key: string): AsyncState<T> & { reload: () => void } {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });

  useEffect(() => {
    let live = true;
    fnRef.current().then(
      (data) => live && setSettled({ key, tick, result: { status: "ready", data } }),
      (error: unknown) => live && setSettled({ key, tick, result: { status: "error", error: error instanceof Error ? error : new Error("Something went wrong") } }),
    );
    return () => { live = false; };
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = settled && settled.key === key && settled.tick === tick ? settled.result : ({ status: "loading" } as const);
  return { ...current, reload } as AsyncState<T> & { reload: () => void };
}
