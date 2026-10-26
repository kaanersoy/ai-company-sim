import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { EventLog } from "../src/engine/events.js";
import { CostGuard } from "../src/engine/costGuard.js";
import { runSim } from "../src/engine/loop.js";
import { MockLLM } from "../src/llm/mock.js";
import { validateSummary } from "../src/agents/summary.js";

test("mock run logs one day_summary per day with a product + status", async () => {
  const cfg = loadConfig();
  const log = new EventLog(":memory:");
  await runSim(cfg, log, new CostGuard(cfg, log, new MockLLM()), 3);
  const s = log.all().filter((e) => e.type === "day_summary");
  assert.equal(s.length, 3);
  for (const e of s) {
    const p = e.payload as any;
    assert.ok(p.product.length > 0 && p.status.length > 0);
  }
});

test("validateSummary tolerates garbage", () => {
  assert.deepEqual(validateSummary("nope"), { product: "", status: "", next: "" });
});

test("day 1: CEO alone decides the product and hires; the team starts working on day 2", async () => {
  const cfg = loadConfig();
  assert.equal(cfg.game.startingEmployees.length, 0);
  cfg.game.seed = 0; // idea 0 = cafe stock tool with a 3-person team
  const log = new EventLog(":memory:");
  await runSim(cfg, log, new CostGuard(cfg, log, new MockLLM()), 2);
  const ev = log.all();
  assert.equal(ev.filter((e) => e.type === "hire" && e.day === 1 && (e.payload as any).ok).length, 3);
  assert.equal(ev.filter((e) => e.type === "work" && e.day === 1).length, 0);
  assert.equal(ev.filter((e) => e.type === "work" && e.day === 2).length, 3);
  const s1 = ev.find((e) => e.type === "day_summary" && e.day === 1)!;
  assert.ok((s1.payload as any).product.length > 0);
});

test("different seeds start from different ideas and team sizes; useless staff get fired", async () => {
  const run = async (seed: number, days: number, subscribeAvg?: number) => {
    const cfg = loadConfig();
    cfg.game.seed = seed;
    if (subscribeAvg) cfg.game.subscribeAvg = subscribeAvg;
    const log = new EventLog(":memory:");
    await runSim(cfg, log, new CostGuard(cfg, log, new MockLLM()), days);
    return log.all();
  };
  const products = new Set<string>(), sizes = new Set<number>();
  for (const seed of [0, 1, 2, 3, 4]) {
    const ev = await run(seed, 1);
    products.add((ev.find((e) => e.type === "daily_reply")!.payload as any).reply);
    sizes.add(ev.filter((e) => e.type === "hire" && (e.payload as any).ok).length);
  }
  assert.equal(products.size, 5);
  assert.ok(sizes.size >= 2);
  const ev = await run(0, 6, 11); // nobody can subscribe (threshold above 10): a 3-person team sheds staff after day 4
  assert.ok(ev.some((e) => e.type === "fire" && (e.payload as any).ok));
});
