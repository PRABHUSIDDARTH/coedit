"use client";

import { usePreview } from "./use-repo";

export const useAdmin = () => usePreview("admin", (r) => r.getAdmin());
