import type { Config } from "../config.js";
import { BudgetExceeded, type CostGuard } from "./costGuard.js";
import type { EventLog } from "./events.js";
import { runCustomer, visitors } from "../agents/customer.js";
import { runSummary } from "../agents/summary.js";
import { applyAction, dailySalaryTotal, isBankrupt, dailyCostTotal, charge, decideSubscription, avgScore, subscribers } from "./rules.js";
import { runManager, runWorker } from "../agents/agent.js";
import { remember } from "./memory.js";
import { loadWorld, saveWorld } from "./world.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface RunResult { daysRun: number; stopped: string | null; spentUsd: number }

/** Day loop: morning daily (retros -> CEO reply + plan), work calls, then engine rules. */
export async function runSim(cfg: Config, log: EventLog, guard: CostGuard, days: number, shouldStop: () => boolean = () => false): Promise<RunResult> {
  const w = loadWorld(cfg, log);
  let daysRun = 0;
  const stop = (reason: string) => {
    w.stopped = reason;
    log.append({ day: w.day, type: "sim_stopped", payload: { reason, spentUsd: guard.spentUsd, budget: w.budget } });
    saveWorld(log, w);
    return { daysRun, stopped: reason, spentUsd: guard.spentUsd };
  };

  if (w.stopped === "budget") w.stopped = null; // the spend cap may have been raised: try again (stops again if still too low)
  if (w.stopped) return { daysRun: 0, stopped: w.stopped, spentUsd: guard.spentUsd };

  let ceoReply = "";
  for (let i = 0; i < days; i++) {
    if (shouldStop()) return { daysRun, stopped: "user", spentUsd: guard.spentUsd }; // only between days: state stays consistent
    const day = w.day + 1;
    if (day > cfg.game.maxDays) return stop("max_days");
    if (isBankrupt(w)) return stop("bankrupt");

    try {
      // 1) morning daily: yesterday's retros become visible, then the CEO decides
      for (const e of w.employees) {
        if (w.retros[e.id]) log.append({ day, type: "daily_retro", actor: e.id, payload: { retro: w.retros[e.id] } });
      }
      const m = await runManager(cfg, guard, w, day);
      ceoReply = m.out.reply;
      log.append({ day, type: "daily_reply", actor: "manager", payload: { reply: m.out.reply, actions: m.out.actions }, cost_usd: m.costUsd });
      // engine judges the CEO's hire/fire/spend proposals
      for (const a of m.out.actions) applyAction(cfg, log, w, day, a);
      for (const e of w.employees) log.append({ day, type: "plan", actor: "manager", target: e.id, payload: { task: m.out.plan[e.id] } });

      // 2) work: one call per employee (a new hire spends its first day adapting: no call)
      for (const e of [...w.employees]) {
        if (e.adapting) continue;
        const r = await runWorker(cfg, guard, w, day, e.id, m.out.plan[e.id]);
        log.append({ day, type: "work", actor: e.id, payload: { work: r.out.work, retro: r.out.retro }, cost_usd: r.costUsd });
        w.retros[e.id] = r.out.retro;
        remember(w, e.id, r.out.work);
        w.product.push({ day, agent: e.id, work: r.out.work });
        log.append({ day, type: "product_update", actor: e.id, payload: { entry: r.out.work } });
        if (r.out.message) {
          if (r.out.message.to === "customer") w.customerQuestions = [...w.customerQuestions, `${e.id}: ${r.out.message.text}`].slice(-2);
          else (w.inbox[r.out.message.to] ??= []).push(`${e.id}: ${r.out.message.text}`);
          log.append({ day, type: "message", actor: e.id, target: r.out.message.to, payload: { text: r.out.message.text } });
        }
      }
    } catch (err) {
      if (err instanceof BudgetExceeded) return stop("budget");
      throw err;
    }

    for (const e of w.employees) delete e.adapting;

    // engine-only: salaries
    const salaries = dailySalaryTotal(w);
    const rent = w.rent ?? 0;
    charge(w, dailyCostTotal(w));
    log.append({ day, type: "salary", payload: { total: salaries, rent, budget: w.budget } });
    // engine-only: daily subscription billing (subscribers at the start of the visit round pay today's price)
    for (const cu of subscribers(cfg, w)) {
      const amount = round2(w.price ?? 0);
      w.budget += amount;
      log.append({ day, type: "subscription_payment", actor: cu.id, payload: { name: cu.name, amount, budget: w.budget } });
    }
    w.day = day;
    saveWorld(log, w);
    daysRun++;

    // end-of-day product report for the owner watching (one small call)
    try {
      const s = await runSummary(cfg, guard, w, day, ceoReply);
      w.productSummary = `${s.out.product} ${s.out.status}`.slice(0, 400);
      log.append({ day, type: "day_summary", actor: "manager", payload: s.out, cost_usd: s.costUsd });
      saveWorld(log, w);
    } catch (err) {
      if (err instanceof BudgetExceeded) return stop("budget");
      throw err;
    }

    // 4) customers visit on their own schedule (each sees only the product file); the engine computes every payment
    const today = visitors(cfg, day);
    if (today.length) {
      try {
        const notes: string[] = [];
        for (const cu of today) {
          const c = await runCustomer(cfg, guard, w, day, cu);
          log.append({ day, type: "customer_review", actor: cu.id, payload: { name: cu.name, scores: c.out.scores, feedback: c.out.feedback, answer: c.out.answer }, cost_usd: c.costUsd });
          const was = w.subs?.[cu.id] !== undefined;
          const decision = decideSubscription(cfg, was, w.price ?? 0, cu.payCap, c.out.scores);
          w.subs ??= {};
          if (decision === "subscribe") w.subs[cu.id] = day;
          else if (decision === "cancel") delete w.subs[cu.id];
          log.append({ day, type: "subscription", actor: cu.id, payload: { name: cu.name, action: decision, price: w.price ?? 0, avg: Math.round(avgScore(c.out.scores) * 10) / 10 } });
          notes.push(...[c.out.feedback, c.out.answer].filter(Boolean).map((t) => `${cu.name}: ${t}`));
          saveWorld(log, w);
        }
        w.customerNotes = notes.slice(-3);
        w.customerQuestions = [];
        saveWorld(log, w);
      } catch (err) {
        if (err instanceof BudgetExceeded) return stop("budget");
        throw err;
      }
    }
    log.append({ day, type: "day_end", payload: {} }); // office closes: the UI sends everybody home
  }
  return { daysRun, stopped: null, spentUsd: guard.spentUsd };
}
