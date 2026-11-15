import type { Repo, WorkItem } from "@/lib/data/types";
import { ADMIN_SEED } from "./adminSeed";
import { CANVAS_NODES, DOC_COMMENTS, DOC_HTML, SHEETS } from "./content";
import { ME, MEMBERS } from "./people";
import { ITEMS, WORKSPACES } from "./workspace";

const wait = (ms = 260 + Math.random() * 240) => new Promise((r) => setTimeout(r, ms));
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Dev affordance: `localStorage["coedit.mock.fail"] = "1"` makes every call fail, to see error states. */
async function gate() {
  await wait();
  try {
    if (globalThis.localStorage?.getItem("coedit.mock.fail") === "1") throw new Error("Simulated failure");
  } catch (e) {
    if (e instanceof Error && e.message === "Simulated failure") throw e;
  }
}

const titleOf = (id: string) => ITEMS.find((i) => i.id === id)?.title ?? "Untitled";

export class MockRepo implements Repo {
  async me() { await wait(80); return ME; }
  async listWorkspaces() { await gate(); return WORKSPACES; }
  async listItems(workspaceId: string): Promise<WorkItem[]> {
    await gate();
    return ITEMS.filter((i) => i.workspaceId === workspaceId).map(({ editedMinutesAgo, ...rest }) => ({ ...rest, editedAt: ago(editedMinutesAgo) }));
  }
  async getDoc(id: string) {
    await gate();
    const html = DOC_HTML[id];
    if (!html) throw new Error("That document no longer exists.");
    return {
      title: titleOf(id), html,
      comments: (DOC_COMMENTS[id] ?? []).map(({ minutesAgo, ...c }) => ({ ...c, editedAt: ago(minutesAgo) })),
    };
  }
  async getSheet(id: string) {
    await gate();
    const s = SHEETS[id];
    if (!s) throw new Error("That sheet no longer exists.");
    return { title: titleOf(id), columns: s.columns, rows: s.rows };
  }
  async getCanvas(id: string) {
    await gate();
    const c = CANVAS_NODES[id];
    if (!c) throw new Error("That canvas no longer exists.");
    return { title: titleOf(id), ...c };
  }
  async listMembers() { await gate(); return MEMBERS; }
  async getAdmin() {
    await gate();
    return { ...ADMIN_SEED, audit: ADMIN_SEED.audit.map(({ minutesAgo, ...a }) => ({ ...a, at: ago(minutesAgo) })) };
  }
}
