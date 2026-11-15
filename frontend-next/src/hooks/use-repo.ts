"use client";

import { getPreviewRepo } from "@/lib/data";
import type { PreviewRepo } from "@/lib/data/types";
import { useAsync } from "./use-async";

/** Sample data for the canvas and admin previews. */
export function usePreview<T>(key: string, pick: (repo: PreviewRepo) => Promise<T>) {
  return useAsync(() => pick(getPreviewRepo()), key);
}
