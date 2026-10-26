import type { Config } from "../config.js";
import type { CostGuard } from "../engine/costGuard.js";
import type { WorldState } from "../engine/world.js";
import { extractJson } from "./tools.js";

export const SUMMARY_TOOL = {
  name: "day_summary",
  description: "End-of-day product status report for the (non-technical) owner watching the company.",
  input_schema: {
    type: "object",
    properties: {
      product: { type: "string", description: "What the product is, in plain words, max 30 words" },
      status: { type: "string", description: "What exists/works now and what was added today, max 45 words" },
      next: { type: "string", description: "What comes next, max 20 words" },
    },
    required: ["product", "status"],
  },
} as const;

export interface SummaryOutput { product: string; status: string; next: string }

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function validateSummary(text: string): SummaryOutput {
  const j = extractJson(text) ?? {};
  return { product: clip(j.product, 220), status: clip(j.status, 320), next: clip(j.next, 160) };
}

/** Plain-language product report after each day. Sees only the product file, never internal chat. */
export async function runSummary(cfg: Config, guard: CostGuard, w: WorldState, day: number, ceo = "") {
  const today = w.product.filter((p) => p.day === day).map((p) => `- ${p.agent}: ${p.work.slice(0, 200)}`).join("\n") || (ceo ? `CEO decision: ${ceo.slice(0, 300)}` : "(nobody shipped anything today)");
  const r = await guard.call({
    kind: "summary", actor: "manager", day, maxTokens: cfg.maxTokens.summary ?? 160,
    system: "You write a short end-of-day product report for a non-technical owner. Plain words, concrete, no jargon, no hype. Describe the PRODUCT, not the people.",
    prompt: `Day ${day}.\nPrevious report: ${w.productSummary ?? "(first day)"}\nToday's work:\n${today}\nCustomer notes: ${w.customerNotes.join(" / ") || "(none)"}`,
  });
  return { out: validateSummary(r.text), costUsd: r.costUsd };
}
