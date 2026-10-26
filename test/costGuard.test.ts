import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { EventLog } from "../src/engine/events.js";
import { CostGuard, BudgetExceeded } from "../src/engine/costGuard.js";
import { runSim } from "../src/engine/loop.js";
import { MockLLM } from "../src/llm/mock.js";

const setup = (cap?: number) => {
  const cfg = loadConfig();
  if (cap !== undefined) cfg.maxSpendUsd = cap;
  cfg.game.startingEmployees = [ // fixture team: the real game starts with the CEO alone
    { id: "eng1", role: "engineer", salary: 40 }, { id: "eng2", role: "engineer", salary: 40 }, { id: "mar1", role: "marketing", salary: 35 },
  ];
  const log = new EventLog(":memory:");
  return { cfg, log, guard: new CostGuard(cfg, log, new MockLLM()) };
};
const req = { kind: "worker" as const, actor: "a", system: "s", prompt: "p", maxTokens: 200, day: 1 };

test("5 mock days produce events and stay under cap", async () => {
  const { cfg, log, guard } = setup();
  const r = await runSim(cfg, log, guard, 5);
  assert.equal(r.daysRun, 5);
  assert.ok(log.all().some((e) => e.type === "work"));
  assert.ok(log.all().some((e) => e.type === "daily_reply"));
  assert.ok(guard.spentUsd <= cfg.maxSpendUsd);
});

test("guard refuses a call whose worst case exceeds the cap, without calling the LLM", async () => {
  const { guard } = setup(0.0001);
  await assert.rejects(() => guard.call(req), BudgetExceeded);
  assert.equal(guard.calls, 0);
});

test("tiny cap stops sim cleanly with sim_stopped(budget); spend never exceeds cap", async () => {
  const { cfg, log, guard } = setup(0.003);
  const r = await runSim(cfg, log, guard, 30);
  assert.equal(r.stopped, "budget");
  assert.ok(guard.spentUsd <= 0.003);
  assert.equal(log.all().at(-1)?.type, "sim_stopped");
});

test("spend persists and resumes from the DB", async () => {
  const { cfg, log, guard } = setup();
  await guard.call(req);
  const again = new CostGuard(cfg, log, new MockLLM());
  assert.equal(again.spentUsd, guard.spentUsd);
  assert.equal(again.calls, 1);
});

test("bankrupt stops the sim", async () => {
  const { cfg, log } = setup();
  cfg.game.startingBudget = 100;
  const guard = new CostGuard(cfg, log, new MockLLM());
  const r = await runSim(cfg, log, guard, 10);
  assert.equal(r.stopped, "bankrupt");
});

test("daily flow: retros, plan, work, message, product update; coherent across days", async () => {
  const { cfg, log, guard } = setup();
  await runSim(cfg, log, guard, 5);
  const ev = log.all();
  const of = (t: string, d?: number) => ev.filter((e) => e.type === t && (d === undefined || e.day === d));
  assert.equal(of("daily_retro", 1).length, 0);            // nothing to review on day 1
  assert.equal(of("daily_retro", 2).length, 3);            // day 2 daily shows day 1 retros
  assert.equal(of("plan", 3).length, 3);
  assert.equal(of("work", 5).length, 3);
  assert.ok(of("message").length > 0);
  assert.match((of("plan", 3)[0].payload as any).task, /feature #3/);
  assert.match((of("daily_reply", 2)[0].payload as any).reply, /read 3 retros/);
});

test("prompts stay small (context budget)", async () => {
  const { cfg, log } = setup();
  const sizes: number[] = [];
  const spy = { complete: async (r: any) => { sizes.push(r.system.length + r.prompt.length); return new MockLLM().complete(r); } };
  const guard = new CostGuard(cfg, log, spy);
  await runSim(cfg, log, guard, 12);
  assert.ok(Math.max(...sizes) < 2400, `max prompt chars ${Math.max(...sizes)}`);  // ~<800 tokens
});

import { customerPayment, decideSubscription, applyAction } from "../src/engine/rules.js";
import { loadWorld } from "../src/engine/world.js";
import { RUBRIC } from "../src/agents/customer.js";

test("payment formula: cap * (avg/10)^2, clamped", () => {
  assert.equal(customerPayment(300, { a: 10, b: 10 }), 300);
  assert.equal(customerPayment(300, { a: 5, b: 5 }), 106.07);
  assert.equal(customerPayment(300, { a: 0 }), 0);
  assert.equal(customerPayment(300, { a: 99 }), 300);
});

test("each customer visits on their own schedule; subscribers pay the daily price into the budget", async () => {
  const { cfg, log, guard } = setup();
  await runSim(cfg, log, guard, 10);
  const ev = log.all();
  const reviews = ev.filter((e) => e.type === "customer_review").filter((e) => e.day <= 6);
  const decisions = ev.filter((e) => e.type === "subscription");
  const pays = ev.filter((e) => e.type === "subscription_payment");
  assert.deepEqual(reviews.map((e) => [e.day, e.actor]), [[2, "tom"], [3, "maya"], [4, "tom"], [4, "priya"], [4, "sam"], [5, "lee"], [6, "maya"], [6, "tom"]]);
  assert.equal(decisions.length, ev.filter((e) => e.type === "customer_review").length);
  assert.ok(ev.some((e) => e.type === "set_price" && (e.payload as any).ok));
  assert.ok(pays.length > 0);
  const total = pays.reduce((s, e) => s + (e.payload as any).amount, 0);
  const salaries = ev.filter((e) => e.type === "salary").reduce((s, e) => s + (e.payload as any).total + ((e.payload as any).rent ?? 0), 0);
  const spent = ev.filter((e) => ["hire", "fire", "spend"].includes(e.type) && (e.payload as any).ok).reduce((s, e) => s + ((e.payload as any).fee ?? 0) + ((e.payload as any).severance ?? 0) + ((e.payload as any).amount ?? 0), 0);
  assert.ok(Math.abs((log.getKV<any>("world")).budget - (cfg.game.startingBudget - salaries - spent + total)) < 0.01);
  assert.deepEqual(Object.keys((reviews[0].payload as any).scores), [...RUBRIC]);
});

test("subscribe / cancel / re-subscribe follow scores and price (engine rule)", () => {
  const { cfg } = setup();
  const good = { a: 8, b: 8 }, bad = { a: 2, b: 2 }, ok = { a: 6, b: 6 };
  assert.equal(decideSubscription(cfg, false, 20, 60, good), "subscribe");
  assert.equal(decideSubscription(cfg, false, 20, 60, bad), "none");
  assert.equal(decideSubscription(cfg, false, 90, 60, good), "none");      // too expensive for its value
  assert.equal(decideSubscription(cfg, true, 20, 60, good), "stay");
  assert.equal(decideSubscription(cfg, true, 20, 60, bad), "cancel");
  assert.equal(decideSubscription(cfg, true, 30, 60, ok), "cancel");       // value 21.6 < price
  assert.equal(decideSubscription(cfg, false, 20, 60, good), "subscribe"); // comes back once needs are met
});

test("set_price is judged by the engine (range enforced)", () => {
  const { cfg, log } = setup();
  const w = loadWorld(cfg, log);
  assert.equal(applyAction(cfg, log, w, 1, { type: "set_price", price: 35, reason: "x" } as any).ok, true);
  assert.equal(w.price, 35);
  assert.equal(applyAction(cfg, log, w, 1, { type: "set_price", price: 5000, reason: "x" } as any).ok, false);
  assert.equal(applyAction(cfg, log, w, 1, { type: "set_price", price: 0, reason: "x" } as any).ok, false);
  assert.equal(w.price, 35);
});

test("customer never sees internal talk; asking the customer improves what it knows", async () => {
  const { cfg, log } = setup();
  const prompts: string[] = [];
  const spy = { complete: async (r: any) => { if (r.kind === "customer") prompts.push(r.prompt); return new MockLLM().complete(r); } };
  await runSim(cfg, log, new CostGuard(cfg, log, spy), 3);
  assert.equal(prompts.length, 2);   // tom (day 2) and maya (day 3)
  assert.ok(!/retro|Colleagues|needs a review/.test(prompts[0]));
  assert.match(prompts[0], /QUESTIONS FROM THE TEAM:\n- mar1/);
  assert.ok(!/QUESTIONS FROM THE TEAM:\n- /.test(prompts[1]));   // questions are cleared after a visit
  const rev = log.all().find((e) => e.type === "customer_review")!;
  assert.match((rev.payload as any).answer, /preorders/);
});

test("good subscription income keeps the company alive that would otherwise go bankrupt", async () => {
  const lean = setup(); lean.cfg.game.startingBudget = 900; lean.cfg.game.officeRentPerDay = 0; lean.cfg.customers.forEach((c) => (c.payCap = 0));
  const rich = setup(); rich.cfg.game.startingBudget = 900; rich.cfg.game.officeRentPerDay = 0; rich.cfg.customers.forEach((c) => (c.payCap = 900));
  const a = await runSim(lean.cfg, lean.log, lean.guard, 12);
  const b = await runSim(rich.cfg, rich.log, rich.guard, 12);
  assert.equal(a.stopped, "bankrupt");
  assert.ok(b.daysRun > a.daysRun);
});

test("API cap still stops cleanly with customer calls in the mix", async () => {
  const { cfg, log, guard } = setup(0.006);
  const r = await runSim(cfg, log, guard, 30);
  assert.equal(r.stopped, "budget");
  assert.ok(guard.spentUsd <= 0.006);
});
