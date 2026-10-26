import type { Config, CustomerSpec } from "../config.js";
import type { CostGuard } from "../engine/costGuard.js";
import type { WorldState } from "../engine/world.js";
import { extractJson } from "./tools.js";

export const RUBRIC = ["relevance", "usability", "completeness", "polish"] as const;
export type Criterion = (typeof RUBRIC)[number];

/** Persona with a hidden need. The team only learns it by asking (message to "customer"). */
const persona = (c: CustomerSpec) =>
  `You are ${c.name}, ${c.business}. HIDDEN NEED (reveal only if asked): you want ${c.need}. You only see the product description below, never the team's internal talk. Score honestly 0-10 per criterion; low if the product does not address your need.`;

/** Customers visiting on a given day. */
export const visitors = (cfg: Config, day: number) =>
  cfg.customers.filter((c) => day >= c.firstDay && (day - c.firstDay) % c.everyDays === 0);

export const CUSTOMER_TOOL = {
  name: "review_product",
  description: "Customer review of the product.",
  input_schema: {
    type: "object",
    properties: {
      scores: { type: "object", properties: Object.fromEntries(RUBRIC.map((c) => [c, { type: "number", minimum: 0, maximum: 10 }])) },
      feedback: { type: "string", description: "Max 30 words" },
      answer: { type: "string", description: "Short answer to the team's question, if any" },
    },
    required: ["scores", "feedback"],
  },
} as const;

export interface CustomerOutput { scores: Record<Criterion, number>; feedback: string; answer: string }

export function validateCustomer(text: string): CustomerOutput {
  const j = extractJson(text) ?? {};
  const scores = {} as Record<Criterion, number>;
  for (const c of RUBRIC) {
    const n = Number(j.scores?.[c]);
    scores[c] = Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 0;
  }
  return {
    scores,
    feedback: typeof j.feedback === "string" ? j.feedback.slice(0, 200) : "",
    answer: typeof j.answer === "string" ? j.answer.slice(0, 200) : "",
  };
}

/** Customer sees ONLY the product file (+ pending questions), nothing internal. */
export async function runCustomer(cfg: Config, guard: CostGuard, w: WorldState, day: number, c: CustomerSpec) {
  const subscribed = w.subs?.[c.id] !== undefined;
  const product = w.product.slice(-8).map((p) => `- ${p.work.slice(0, 120)}`).join("\n") || "(nothing yet)";
  const questions = w.customerQuestions.map((q) => `- ${q}`).join("\n") || "(none)";
  const r = await guard.call({
    kind: "customer", actor: c.id, day, maxTokens: cfg.maxTokens.customer, system: persona(c),
    prompt: `The product costs ${w.price ?? 0} per day (daily subscription). You are ${subscribed ? "currently subscribed" : "not subscribed"}; low scores make you cancel or stay away, high scores at a fair price make you subscribe.\nPRODUCT:\n${product}\nQUESTIONS FROM THE TEAM:\n${questions}\nCriteria: ${RUBRIC.join(", ")}.`,
  });
  return { out: validateCustomer(r.text), costUsd: r.costUsd };
}
