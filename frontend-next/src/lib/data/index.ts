/** The only module that picks between mock and real implementations. Everything else in the app
 *  imports from here, never from `@/mocks`. To go live: implement the three interfaces over the
 *  real backend and return them in the `else` branches. */
import type { CollabProvider } from "@/lib/collab/types";
import type { CouncilClient } from "@/lib/council/types";
import { USE_MOCKS } from "@/lib/env";
import { MockCollabProvider } from "@/mocks/MockCollabProvider";
import { MockCouncilClient } from "@/mocks/MockCouncilClient";
import { MockRepo } from "@/mocks/MockRepo";
import type { Repo } from "./types";

let repo: Repo | undefined;
let council: CouncilClient | undefined;

export function getRepo(): Repo {
  if (!USE_MOCKS) throw new Error("No real Repo is wired yet: set NEXT_PUBLIC_USE_MOCKS=true or implement one in lib/data/index.ts.");
  return (repo ??= new MockRepo());
}

export function getCouncilClient(): CouncilClient {
  if (!USE_MOCKS) throw new Error("No real CouncilClient is wired yet.");
  return (council ??= new MockCouncilClient());
}

/** One provider per open document, so this always returns a fresh instance. */
export function createCollabProvider(): CollabProvider {
  if (!USE_MOCKS) throw new Error("No real CollabProvider is wired yet.");
  return new MockCollabProvider();
}
