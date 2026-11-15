import type { PreviewRepo } from "@/lib/data/types";
import { ADMIN_SEED } from "./adminSeed";
import { CANVAS_NODES } from "./content";

const wait = (ms = 260 + Math.random() * 240) => new Promise((r) => setTimeout(r, ms));
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const TITLES: Record<string, string> = { "onboarding-flow": "Onboarding flow (preview)", "system-map": "System map (preview)" };

/** Sample data for the two areas with no backend yet: canvas and the admin console. */
export class MockRepo implements PreviewRepo {
  async getCanvas(id: string) {
    await wait();
    const c = CANVAS_NODES[id];
    if (!c) throw new Error("That sample canvas doesn't exist.");
    return { title: TITLES[id] ?? "Canvas (preview)", ...c };
  }
  async getAdmin() {
    await wait();
    return { ...ADMIN_SEED, audit: ADMIN_SEED.audit.map(({ minutesAgo, ...a }) => ({ ...a, at: ago(minutesAgo) })) };
  }
}
