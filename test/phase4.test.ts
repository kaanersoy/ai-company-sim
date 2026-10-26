import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { EventLog } from "../src/engine/events.js";
import { CostGuard, BudgetExceeded } from "../src/engine/costGuard.js";
import { loadWorld } from "../src/engine/world.js";
import { applyAction } from "../src/engine/rules.js";
import { runSim } from "../src/engine/loop.js";
import { ClaudeClient } from "../src/llm/client.js";
import type { LLMClient, LLMRequest } from "../src/llm/types.js";

const world = () => {
  const cfg = loadConfig();
  const log = new EventLog(":memory:");
  const w = loadWorld(cfg, log);
  w.employees = [
    { id: "eng1", role: "engineer", salary: 40 }, { id: "eng2", role: "engineer", salary: 40 }, { id: "mkt1", role: "marketing", salary: 35 },
  ];
  return { cfg, log, w };
};

test("hire: charges fee, adds adapting employee, logs event", () => {
  const { cfg, log, w } = world();
  const before = w.budget;
  const r = applyAction(cfg, log, w, 1, { type: "hire", role: "designer", salary: 30, personality: "calm" });
  assert.ok(r.ok);
  assert.equal(w.employees.length, 4);
  assert.equal(w.budget, before - cfg.game.hiringFee);
  assert.equal(w.employees[3].adapting, true);
  assert.ok(log.all().some((e) => e.type === "hire" && (e.payload as any).ok));
});

test("hire: rejects over max employees, bad salary, unaffordable", () => {
  const { cfg, log, w } = world();
  assert.ok(!applyAction(cfg, log, w, 1, { type: "hire", role: "x", salary: 0 }).ok);
  assert.ok(!applyAction(cfg, log, w, 1, { type: "hire", role: "x", salary: 9999 }).ok);
  applyAction(cfg, log, w, 1, { type: "hire", role: "a", salary: 20 });
  applyAction(cfg, log, w, 1, { type: "hire", role: "b", salary: 20 });
  assert.equal(w.employees.length, 5);
  assert.ok(!applyAction(cfg, log, w, 1, { type: "hire", role: "c", salary: 20 }).ok);
  w.budget = 10;
  w.employees.pop();
  assert.ok(!applyAction(cfg, log, w, 1, { type: "hire", role: "d", salary: 20 }).ok);
});

test("fire: severance, wipes memory, manager protected, unknown rejected", () => {
  const { cfg, log, w } = world();
  w.memory.eng1 = ["x"]; w.inbox.eng1 = ["y"]; w.retros.eng1 = "z";
  const before = w.budget;
  assert.ok(applyAction(cfg, log, w, 1, { type: "fire", agentId: "eng1" }).ok);
  assert.equal(w.budget, before - 40 * cfg.game.severanceDays);
  assert.ok(!w.employees.some((e) => e.id === "eng1"));
  assert.equal(w.memory.eng1, undefined);
  assert.equal(w.inbox.eng1, undefined);
  assert.equal(w.retros.eng1, undefined);
  assert.ok(!applyAction(cfg, log, w, 1, { type: "fire", agentId: "manager" }).ok);
  assert.ok(!applyAction(cfg, log, w, 1, { type: "fire", agentId: "nobody" }).ok);
});

test("spend: approved within caps, rejected over cap or when payroll is endangered", () => {
  const { cfg, log, w } = world();
  const before = w.budget;
  assert.ok(applyAction(cfg, log, w, 1, { type: "spend", amount: 50, reason: "ads" }).ok);
  assert.equal(w.budget, before - 50);
  assert.ok(!applyAction(cfg, log, w, 1, { type: "spend", amount: cfg.game.spendCapPerAction + 1 }).ok);
  assert.ok(!applyAction(cfg, log, w, 1, { type: "spend", amount: -5 }).ok);
  w.budget = 120;
  assert.ok(!applyAction(cfg, log, w, 1, { type: "spend", amount: 50 }).ok);
});

/** LLM that hires on day 1, tracking which actors get a worker call. */
class HiringLLM implements LLMClient {
  workers: string[] = [];
  async complete(req: LLMRequest) {
    if (req.kind === "manager") {
      const hire = req.day === 1 ? [{ type: "hire", role: "designer", salary: 30, personality: "bold" }] : [];
      return { text: JSON.stringify({ reply: "ok", plan: {}, actions: hire }), inputTokens: 10, outputTokens: 10 };
    }
    if (req.kind === "worker") this.workers.push(`${req.day}:${req.actor}`);
    const text = req.kind === "customer" ? JSON.stringify({ scores: { a: 5 }, feedback: "f", answer: "a" }) : JSON.stringify({ work: "w", retro: "r" });
    return { text, inputTokens: 10, outputTokens: 10 };
  }
}

test("new hire skips its adaptation day, works from the next day", async () => {
  const cfg = loadConfig();
  const log = new EventLog(":memory:");
  const llm = new HiringLLM();
  await runSim(cfg, log, new CostGuard(cfg, log, llm), 2);
  assert.ok(!llm.workers.includes("1:des1"));
  assert.ok(llm.workers.includes("2:des1"));
});

const fakeApi = (content: any[], usage = { input_tokens: 123, output_tokens: 45 }) => {
  const calls: any[] = [];
  return { calls, create: async (b: any) => { calls.push(b); return { content, usage }; } };
};
const req: LLMRequest = { kind: "worker", actor: "eng1", system: "sys", prompt: "hi", maxTokens: 200, day: 1 };

test("ClaudeClient: forces the tool, returns tool input as JSON, maps usage", async () => {
  const api = fakeApi([{ type: "tool_use", name: "daily_work", input: { work: "w", retro: "r" } }]);
  const r = await new ClaudeClient("m", api).complete(req);
  assert.deepEqual(JSON.parse(r.text), { work: "w", retro: "r" });
  assert.equal(r.inputTokens, 123);
  assert.equal(r.outputTokens, 45);
  assert.deepEqual(api.calls[0].tool_choice, { type: "tool", name: "daily_work" });
  assert.equal(api.calls[0].max_tokens, 200);
});

test("real-client usage is converted to cost via config prices", async () => {
  const cfg = loadConfig();
  const log = new EventLog(":memory:");
  const guard = new CostGuard(cfg, log, new ClaudeClient("m", fakeApi([{ type: "tool_use", input: {} }])));
  const r = await guard.call(req);
  assert.ok(Math.abs(r.costUsd - (123 * 1 + 45 * 5) / 1e6) < 1e-12);
  assert.ok(Math.abs(guard.spentUsd - r.costUsd) < 1e-12);
});

test("real client: tool overhead counted in the worst case; clean stop at the cap", async () => {
  const cfg = loadConfig();
  cfg.maxSpendUsd = 0.004;
  const log = new EventLog(":memory:");
  const api = fakeApi([{ type: "tool_use", input: { work: "w", retro: "r", reply: "r", plan: {} } }], { input_tokens: 800, output_tokens: 150 });
  const client = new ClaudeClient("m", api);
  const guard = new CostGuard(cfg, log, client);
  assert.ok(guard.worstCase(req) > new CostGuard(cfg, log, { complete: client.complete.bind(client) }).worstCase(req));
  const r = await runSim(cfg, log, guard, 30);
  assert.equal(r.stopped, "budget");
  assert.ok(guard.spentUsd <= cfg.maxSpendUsd);
  await assert.rejects(() => guard.call({ ...req, maxTokens: 100000 }), BudgetExceeded);
});
