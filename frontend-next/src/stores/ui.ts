import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PageKind } from "@/lib/nav";

export interface PageMeta { title: string; kind?: PageKind; peers: { id: string; name: string; seat: number }[] }

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  sidebarOpen: boolean; // mobile drawer
  setSidebarOpen: (open: boolean) => void;
  shareOpen: boolean;
  setShareOpen: (open: boolean) => void;
  /** Selection handed to the council from a doc ("Ask Council"). */
  councilSeed: string;
  setCouncilSeed: (text: string) => void;
  /** What the open page shows in the top bar. Pages set it on mount and clear it on unmount. */
  meta: PageMeta | null;
  setMeta: (meta: PageMeta | null) => void;
  workspaceId: string;
  setWorkspaceId: (id: string) => void;
}

export const useUi = create<UiState>()(persist((set) => ({
  paletteOpen: false, setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  sidebarOpen: false, setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  shareOpen: false, setShareOpen: (shareOpen) => set({ shareOpen }),
  councilSeed: "", setCouncilSeed: (councilSeed) => set({ councilSeed }),
  meta: null, setMeta: (meta) => set({ meta }),
  workspaceId: "", setWorkspaceId: (workspaceId) => set({ workspaceId }),
}), { name: "coedit.ui", partialize: (s) => ({ workspaceId: s.workspaceId }) }));
