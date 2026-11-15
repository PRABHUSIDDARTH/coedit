"use client";

import { useRepo } from "./use-repo";

export const useAdmin = () => useRepo("admin", (r) => r.getAdmin());
