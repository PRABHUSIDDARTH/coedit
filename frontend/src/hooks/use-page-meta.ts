"use client";

import { useEffect } from "react";
import { useUi, type PageMeta } from "@/stores/ui";

/** Tells the top bar what the open page is. Clears on unmount. */
/** Pass `undefined` to leave the top bar to a child that sets it itself. */
export function usePageMeta(meta: PageMeta | null | undefined) {
  const setMeta = useUi((s) => s.setMeta);
  const key = meta === undefined ? "-" : meta ? JSON.stringify(meta) : "";
  useEffect(() => {
    if (meta === undefined) return;
    setMeta(meta);
    return () => setMeta(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
