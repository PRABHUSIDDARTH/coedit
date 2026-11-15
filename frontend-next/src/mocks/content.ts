export const DOC_HTML: Record<string, string> = {
  "q3-launch-brief": `
<h1>Q3 launch brief</h1>
<p>This brief sets out what ships in Q3, who it is for and how we will know it worked. It is the single source for the launch review on the 28th.</p>
<h2>Goal</h2>
<p>Move trial-to-paid conversion from 9% to 13% by the end of the quarter, without raising support load. We have six weeks of trial data and two customer interviews behind this target, so treat it as a range until the cohort release reports.</p>
<h2>What ships</h2>
<ul>
<li><p>Shared workspaces with roles for owner, editor and viewer.</p></li>
<li><p>Live cursors and comments in docs, sheets and the canvas.</p></li>
<li><p>The AI Council, available from any doc through <strong>Ask Council</strong>.</p></li>
</ul>
<h2>Rollout plan</h2>
<table>
<tbody>
<tr><th><p>Phase</p></th><th><p>Audience</p></th><th><p>Owner</p></th><th><p>Date</p></th></tr>
<tr><td><p>Dogfood</p></td><td><p>Internal team</p></td><td><p>Operator</p></td><td><p>Wed 12 Nov</p></td></tr>
<tr><td><p>Cohort release</p></td><td><p>10% of accounts</p></td><td><p>Marcus Webb</p></td><td><p>Mon 17 Nov</p></td></tr>
<tr><td><p>Review</p></td><td><p>Leadership</p></td><td><p>Priya Nair</p></td><td><p>Fri 21 Nov</p></td></tr>
</tbody>
</table>
<h2>Open questions</h2>
<p>We still need a <mark data-comment="c1">written stop condition</mark> for the cohort release. Without one, the review becomes a debate about momentum.</p>
<p>The billing sync for accounts mid-cycle is the most likely place for the rollout to break. The check below should pass before the cohort release:</p>
<pre><code>const midCycle = accounts.filter((a) =&gt; a.cycleDay &gt; 1 &amp;&amp; a.plan !== "free");
expect(await syncBilling(midCycle)).toHaveLength(0); // no unsynced accounts</code></pre>
<p>Type <code>/</code> to insert a block, or select text and choose <strong>Ask Council</strong> to get a second opinion.</p>`,
  "interview-notes": `<h1>Customer interview notes</h1><p>Two calls so far. Add each interview below with the date, the account and one quote worth keeping.</p><h2>Northwind Logistics, 6 Nov</h2><ul><li><p>Wants one place for specs and the numbers behind them.</p></li><li><p>Shares sheets by screenshot today. Calls it "the thing that always goes stale".</p></li></ul>`,
  "release-checklist": `<h1>Release checklist</h1><ul><li><p>Migrations applied to staging</p></li><li><p>Billing sync tested on a mid-cycle account</p></li><li><p>Rollback flag verified</p></li><li><p>Support has the announcement text</p></li></ul>`,
  "editorial-calendar": `<h1>Editorial calendar</h1><p>Four weeks of posts, one owner each. Move a row when the date changes so the team sees it.</p>`,
};

export const DOC_COMMENTS: Record<string, { id: string; author: string; seat: number; text: string; minutesAgo: number }[]> = {
  "q3-launch-brief": [
    { id: "c1", author: "Inés Duarte", seat: 3, text: "Can we say what number of accounts would make us stop? Even a rough one helps.", minutesAgo: 18 },
  ],
};

import type { CanvasNode, SheetColumn } from "@/lib/data/types";

export interface SheetSeed { columns: SheetColumn[]; rows: string[][] }

export const SHEETS: Record<string, SheetSeed> = {
  "q3-revenue-model": {
    columns: [
      { id: "plan", label: "Plan", type: "text", width: 150 },
      { id: "seats", label: "Seats", type: "number", width: 90 },
      { id: "price", label: "Price per seat", type: "currency", width: 120 },
      { id: "mrr", label: "MRR", type: "currency", width: 120 },
      { id: "churn", label: "Monthly churn", type: "percent", width: 120 },
      { id: "net", label: "Net MRR", type: "currency", width: 120 },
      { id: "status", label: "Status", type: "status", width: 120 },
      { id: "owner", label: "Owner", type: "text", width: 130 },
      { id: "notes", label: "Notes", type: "text", width: 240 },
    ],
    rows: [
      ["Free", "4200", "0", "=B1*C1", "0.12", "=D1*(1-E1)", "Stable", "Marcus Webb", "Funnel top; no revenue"],
      ["Team", "640", "12", "=B2*C2", "0.04", "=D2*(1-E2)", "Growing", "Marcus Webb", "Trial conversion is the lever"],
      ["Business", "210", "29", "=B3*C3", "0.03", "=D3*(1-E3)", "Growing", "Inés Duarte", "Two accounts near the tier boundary"],
      ["Enterprise", "24", "210", "=B4*C4", "0.01", "=D4*(1-E4)", "At risk", "Priya Nair", "Renewal in December"],
      ["Education", "380", "5", "=B5*C5", "0.06", "=D5*(1-E5)", "Stable", "Kenji Sato", ""],
      ["Add-ons", "150", "8", "=B6*C6", "0.05", "=D6*(1-E6)", "Growing", "Kenji Sato", "Council seats billed per seat"],
      ["Total", "=SUM(B1:B6)", "", "=SUM(D1:D6)", "", "=SUM(F1:F6)", "", "", "Check against billing export"],
    ],
  },
  "hiring-plan": {
    columns: [
      { id: "role", label: "Role", type: "text", width: 180 },
      { id: "team", label: "Team", type: "text", width: 120 },
      { id: "start", label: "Target start", type: "date", width: 130 },
      { id: "cost", label: "Annual cost", type: "currency", width: 130 },
      { id: "status", label: "Status", type: "status", width: 120 },
    ],
    rows: [
      ["Staff engineer, realtime", "Platform", "2026-01-12", "210000", "Open"],
      ["Product designer", "Design", "2026-02-02", "150000", "Interviewing"],
      ["Support lead", "Customers", "2026-01-26", "110000", "Offer"],
      ["Data analyst", "Growth", "2026-03-02", "125000", "Open"],
    ],
  },
};

/** Canvas seed in token names, resolved to real colors at render time. */
export const CANVAS_NODES: Record<string, { nodes: CanvasNode[]; edges: [string, string][] }> = {
  "onboarding-flow": {
    nodes: [
      { id: "a", label: "Sign up", x: 40, y: 140, w: 170, h: 70, token: "azure" },
      { id: "b", label: "Verify email", x: 300, y: 140, w: 190, h: 70, token: "cyan" },
      { id: "c", label: "Create workspace", x: 580, y: 140, w: 230, h: 70, token: "mint" },
      { id: "d", label: "Invite your team", x: 900, y: 40, w: 220, h: 70, token: "orange" },
      { id: "e", label: "Write the first doc", x: 900, y: 240, w: 240, h: 70, token: "sun" },
    ],
    edges: [["a", "b"], ["b", "c"], ["c", "d"], ["c", "e"]],
  },
  "system-map": {
    nodes: [
      { id: "web", label: "Web app", x: 60, y: 120, w: 170, h: 70, token: "azure" },
      { id: "sync", label: "Realtime sync", x: 340, y: 40, w: 220, h: 70, token: "cyan" },
      { id: "api", label: "API", x: 340, y: 240, w: 220, h: 70, token: "mint" },
      { id: "db", label: "Postgres", x: 660, y: 140, w: 190, h: 70, token: "orange" },
    ],
    edges: [["web", "sync"], ["web", "api"], ["sync", "db"], ["api", "db"]],
  },
};
