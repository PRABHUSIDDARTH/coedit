"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};
/** False on the server and during hydration, true afterwards, without an effect that sets state. */
export function useMounted(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
