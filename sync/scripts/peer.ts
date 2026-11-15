/**
 * A scripted second user for checking live collaboration by hand against a running stack:
 * logs in, joins a doc, types a paragraph (with a visible named caret), stays for a while,
 * and prints the document text it sees at the end.
 *   npx tsx scripts/peer.ts <email> <password> <fileId> [text] [holdSeconds]
 * For a sheet, pass text as "@B1=7" to set that cell (and park the peer's selection on it).
 */
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

const [email, password, fileId, text = "", hold = "10"] = process.argv.slice(2);
const ORIGIN = process.env.ORIGIN ?? "http://localhost:5173";
/** The API says "/sync" (a path); Next cannot proxy WebSockets, so go to the sync server directly. */
const syncUrl = (u: string) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : (process.env.SYNC_URL ?? "ws://localhost:1234"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${ORIGIN}/api/auth/login`, {
  method: "POST",
  headers: { "X-Requested-With": "coedit", "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) throw new Error(`login -> ${login.status}`);
const cookie = login.headers.getSetCookie()[0].split(";")[0];

const res = await fetch(`${ORIGIN}/api/files/${fileId}/ws-ticket`, {
  method: "POST",
  headers: { "X-Requested-With": "coedit", Cookie: cookie },
});
if (!res.ok) throw new Error(`ws-ticket -> ${res.status}`);
const t = (await res.json()) as { ticket: string; url: string; read_only: boolean; name: string; color: string };

const doc = new Y.Doc();
let synced = false;
const provider = new HocuspocusProvider({
  url: syncUrl(t.url),
  name: fileId,
  token: t.ticket,
  document: doc,
  onSynced: () => (synced = true),
});
for (let i = 0; i < 200 && !synced; i++) await sleep(25);
if (!synced) throw new Error("could not sync");

const fragment = doc.getXmlFragment("default");
const cellEdit = /^@([A-Z][0-9]+)=(.*)$/.exec(text);
if (cellEdit) {
  doc.getMap<string>("cells").set(cellEdit[1], cellEdit[2]);
  provider.awareness?.setLocalState({ user: { name: t.name, color: t.color }, cell: cellEdit[1] });
} else if (text) {
  const paragraph = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  paragraph.insert(0, [content]);
  fragment.push([paragraph]);
  for (const ch of text) {
    content.insert(content.length, ch);
    const at = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(content, content.length));
    provider.awareness?.setLocalState({ user: { name: t.name, color: t.color }, cursor: { anchor: at, head: at } });
    await sleep(40);
  }
}
console.log(`${t.name} joined (read_only=${t.read_only}); holding ${hold}s`);
await sleep(Number(hold) * 1000);
console.log("DOC " + JSON.stringify(fragment.toArray().map((n) => n.toString())));
console.log("CELLS " + JSON.stringify(doc.getMap("cells").toJSON()));
provider.destroy();
