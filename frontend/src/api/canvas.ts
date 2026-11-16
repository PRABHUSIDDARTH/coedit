import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { sanitizeLoadedScene, type Scene } from "@/lib/canvas";

export interface SceneResponse { scene: Scene; revision: number; updated_at: string | null }
export interface SavedResponse { revision: number; updated_at: string; links_removed: number }

export const sceneKey = (fileId: string) => ["canvas-scene", fileId] as const;

/** The stored scene. Loaded once per open canvas: no background refetch, so a refetch can never replace what you are drawing. */
export function useScene(fileId: string) {
  return useQuery({
    queryKey: sceneKey(fileId),
    queryFn: async (): Promise<SceneResponse> => {
      const r = await api<{ scene: unknown; revision: number; updated_at: string | null }>(`/files/${fileId}/scene`);
      return { ...r, scene: sanitizeLoadedScene(r.scene) };
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export const fetchScene = (fileId: string) =>
  api<{ scene: unknown; revision: number; updated_at: string | null }>(`/files/${fileId}/scene`).then((r) => ({ ...r, scene: sanitizeLoadedScene(r.scene) }));

export const saveScene = (fileId: string, baseRevision: number, scene: Scene) =>
  api<SavedResponse>(`/files/${fileId}/scene`, { method: "PUT", body: { base_revision: baseRevision, scene } });
