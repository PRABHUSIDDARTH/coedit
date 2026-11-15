/** Preview data: the only place that imports from `@/mocks`.
 *  Docs, sheets, files, members, keys and the Council use the real API (`@/api`). Canvas and the admin
 *  console have no backend yet, so they run on sample data and a simulated collaborator provider. */
import type { CollabProvider } from "@/lib/collab/types";
import { MockCollabProvider } from "@/mocks/MockCollabProvider";
import { MockRepo } from "@/mocks/MockRepo";
import type { PreviewRepo } from "./types";

let repo: PreviewRepo | undefined;
export const getPreviewRepo = (): PreviewRepo => (repo ??= new MockRepo());

/** One provider per open canvas, so this always returns a fresh instance. */
export const createCollabProvider = (): CollabProvider => new MockCollabProvider();
