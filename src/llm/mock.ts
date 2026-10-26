import { IDEAS, ideaByPitch } from "../engine/ideas.js";
import type { LLMClient, LLMRequest, LLMResponse } from "./types.js";

/** Deterministic, context-aware fake client: $0, same input -> same output. */
export class MockLLM implements LLMClient {
  async complete(req: LLMRequest): Promise<LLMResponse> {
    let obj: unknown;
    if (req.kind === "manager") {
      const ids = (req.prompt.match(/plan for: (.*)\.$/m)?.[1] ?? "").split(", ").filter(Boolean);
      const retros = (req.prompt.match(/^\w+: (?!\(none yet\)).*$/gm) ?? []).filter((l) => /^\w+: day \d+/.test(l));
      const plan: Record<string, string> = {};
      ids.forEach((id) => (plan[id] = `Build feature #${req.day} for the customer (${id}).`));
      const runway = Number(req.prompt.match(/cash lasts ~(\d+) days/)?.[1] ?? 99);
      const noSubs = /\b0 subscribers/.test(req.prompt);
      const fire = ids.length > 1 && runway <= 3 ? [{ type: "fire", agentId: ids[ids.length - 1], reason: "cash is running out" }]
        : ids.length > 1 && req.day >= 4 && noSubs ? [{ type: "fire", agentId: ids[ids.length - 1], reason: "no subscribers, the team is too big for the product" }] : [];
      const idea = ideaByPitch(req.prompt) ?? IDEAS[0];
      obj = {
        reply: !ids.length ? `Day ${req.day}: we build ${idea.product}` : retros.length ? `Day ${req.day}: read ${retros.length} retros, doubling down on what worked.` : `Day ${req.day}: kickoff, let's ship.`,
        plan,
        actions: ids.length ? [...(req.day === 1 ? [{ type: "set_price", price: 25 }] : []), ...fire] : [{ type: "set_price", price: 25 }, ...idea.team.map((t) => ({ type: "hire", ...t }))],
      };
    } else if (req.kind === "worker") {
      const task = req.prompt.match(/TODAY'S TASK: (.*)$/m)?.[1] ?? "";
      const colleague = req.prompt.match(/Colleagues: (\w+)/)?.[1];
      obj = {
        work: `${req.actor}: ${task}`,
        retro: `day ${req.day}: ${req.day % 2 ? "shipped fast" : "slow, unclear spec"}`,
        message: req.actor.startsWith("mar") && req.day === 2 ? { to: "customer", text: "What problem should the product solve?" } : colleague && req.day % 2 === 0 ? { to: colleague, text: `${req.actor} needs a review on day ${req.day}` } : undefined,
      };
    } else if (req.kind === "summary") {
      obj = {
        product: (IDEAS.find((i) => req.prompt.includes(i.product)) ?? IDEAS[0]).product,
        status: `Day ${req.day}: ${(req.prompt.match(/^- /gm) ?? []).length} features worked on so far today; the tool is taking shape.`,
        next: "Polish and connect the pieces.",
      };
    } else {
      const entries = (req.prompt.match(/^- /gm) ?? []).length;
      const asked = /QUESTIONS FROM THE TEAM:\n- /.test(req.prompt);
      const fit = ({ maya: 0, tom: -1, sam: -2, priya: -3, lee: -4 } as Record<string, number>)[req.actor] ?? -2; // how close the cafe-stock product is to each customer
      const base = Math.max(0, Math.min(9, 3 + Math.floor(entries / 2) + (asked ? 2 : 0) + fit));
      const need = req.system.match(/you want (.*?)\. You only/)?.[1] ?? "something useful";
      obj = {
        scores: { relevance: base, usability: Math.min(10, base + 1), completeness: Math.max(0, base - 1), polish: base },
        feedback: base >= 6 ? "Getting useful, keep going." : "Not what I need yet; ask me about my business.",
        answer: asked ? `I need ${need}.` : "",
      };
    }
    const text = JSON.stringify(obj);
    return {
      text,
      inputTokens: Math.ceil((req.system.length + req.prompt.length) / 4),
      outputTokens: Math.min(req.maxTokens, Math.ceil(text.length / 4)),
    };
  }
}
