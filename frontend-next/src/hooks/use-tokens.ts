"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/** Resolves CSS custom properties (e.g. "--azure") to concrete colors for libraries that cannot read
 *  CSS variables (canvas, Excalidraw). Re-resolves when the theme changes. Returns "" on the server. */
export function useTokens<T extends string>(names: readonly T[], opts?: { theme?: "light" | "dark" }): Record<T, string> {
  const { resolvedTheme } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  const key = names.join(",");
  useEffect(() => {
    // Wait a frame so next-themes has applied the new attributes before we read computed styles.
    const id = requestAnimationFrame(() => {
      // With `theme`, read that theme's values regardless of the active one, using a scoped element.
      // (Excalidraw inverts element colors itself in dark mode, so it must be given the light values.)
      let host: HTMLElement = document.documentElement;
      let probe: HTMLElement | null = null;
      if (opts?.theme) { probe = document.createElement("div"); probe.setAttribute("data-theme", opts.theme); probe.hidden = true; document.body.appendChild(probe); host = probe; }
      const cs = getComputedStyle(host);
      setValues(Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()])));
      probe?.remove();
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, key, opts?.theme]);
  return values as Record<T, string>;
}
