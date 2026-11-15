import type { Seat } from "@/lib/council/types";

export const SEATS: Seat[] = [
  { id: "analyst", name: "Analyst", role: "Checks the numbers", brief: "Quantifies the claim, names the assumptions and flags anything that cannot be measured.", model: "claude-sonnet-5-5" },
  { id: "critic", name: "Critic", role: "Argues the other side", brief: "Finds the weakest point in the plan and says what would make it fail.", model: "gpt-6.1-terra" },
  { id: "writer", name: "Writer", role: "Makes it clear", brief: "Rewrites for a reader who has five minutes and no context.", model: "claude-sonnet-5-5" },
  { id: "strategist", name: "Strategist", role: "Weighs the trade-offs", brief: "Compares options by cost, reversibility and what each one makes harder later.", model: "gemini-3.8-flash" },
  { id: "researcher", name: "Researcher", role: "Brings the evidence", brief: "Lists what is known, what is guessed and the fastest way to find out.", model: "gemini-3.8-flash" },
  { id: "operator", name: "Operator", role: "Plans the rollout", brief: "Turns the decision into steps, owners and a date, and names the first thing to go wrong.", model: "gpt-6.1-terra" },
];

/** Canned, seat-specific takes. `{topic}` is replaced with a short quote of the user's prompt. */
export const SEAT_TAKES: Record<string, string[]> = {
  analyst: [
    "Start with what we can count. On {topic}, the only figure we have today is the trial conversion rate, and it comes from six weeks of data.",
    "That is enough to size the upside but not enough to promise it. I would treat the estimate as a range, not a point, and write the range down.",
    "Two assumptions carry most of the weight: that trial users behave like paying users, and that support load stays flat. Both are testable within a sprint.",
  ],
  critic: [
    "The plan reads well, which is the problem. On {topic}, nothing in it says what would make us stop.",
    "If conversion is the goal, the cheapest way to miss it is to ship to everyone at once and learn nothing about who it works for.",
    "I would not block this. I would ask for a kill criterion before kickoff, so the decision to continue is made with data and not with momentum.",
  ],
  writer: [
    "The idea is sound but the framing is long. For {topic}, the reader needs three things up front: what changes, who it affects and when.",
    "Cut the background to two sentences. Put the decision first, the reasons second, and the open questions last, each with an owner.",
    "Replace 'leverage' and 'streamline' with what actually happens. If a sentence survives that edit, keep it.",
  ],
  strategist: [
    "There are three real options for {topic}: ship broadly, ship to a cohort first, or wait for more data. They differ mostly in how easily we can undo them.",
    "A cohort release is the only option that keeps both other doors open. It costs about two weeks and buys the evidence the other two lack.",
    "The risk of waiting is competitive, but nothing here suggests a competitor ships in that window. I would not pay for speed we cannot use.",
  ],
  researcher: [
    "What we know about {topic}: the trial data, two customer interviews and one competitor change. What we are guessing: willingness to pay at the new price.",
    "The fastest way to close that gap is five short calls with accounts near the tier boundary. That is a day of work, not a study.",
    "I would also pull the last two quarters of support tickets on this area. If the pattern is there, it will show up in the first fifty.",
  ],
  operator: [
    "To run {topic} I need an owner, a date and a rollback. Right now I have the first and a guess at the second.",
    "Proposed order: freeze scope Monday, internal dogfood Wednesday, ten percent of accounts the following Monday, review Friday. The rollback is a flag, not a deploy.",
    "The first thing to break will be the billing sync for accounts mid-cycle. I would test that case before anything else.",
  ],
};

export const SYNTHESIS_PARTS = {
  summary: "Release to a small cohort first, with a written stop condition, and decide on the wider rollout after one review.",
  agreed: [
    "The numbers support the upside but not a promise, so present the estimate as a range.",
    "A staged release keeps every later option open and costs about two weeks.",
    "Someone needs to own the date and the rollback before kickoff.",
  ],
  split: [
    "The Critic wants a hard kill criterion; the Strategist treats the review meeting as the checkpoint.",
    "The Researcher wants customer calls first; the Operator wants to start the dogfood in parallel.",
  ],
  next: "Draft the stop condition today, book five customer calls near the tier boundary and start the internal dogfood on Wednesday.",
};
