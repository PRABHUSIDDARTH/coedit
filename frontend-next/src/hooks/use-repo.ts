"use client";

import { getRepo } from "@/lib/data";
import type { Repo } from "@/lib/data/types";
import { useAsync } from "./use-async";

/** `useRepo("items:northwind", (r) => r.listItems("northwind"))` */
export function useRepo<T>(key: string, pick: (repo: Repo) => Promise<T>) {
  return useAsync(() => pick(getRepo()), key);
}
