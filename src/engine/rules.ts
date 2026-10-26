import type { Config } from "../config.js";
import type { ManagerAction } from "../agents/tools.js";
import type { EventLog } from "./events.js";
import type { WorldState } from "./world.js";

export function dailySalaryTotal(w: WorldState) {
  return w.employees.reduce((s, e) => s + e.salary, 0);
}

/** Everything paid at the end of each day: salaries + office rent. */
export function dailyCostTotal(w: WorldState) {
  return dailySalaryTotal(w) + (w.rent ?? 0);
}

/** Engine-only money change. Returns false (and changes nothing) if it would go below zero. */
export function charge(w: WorldState, amount: number): boolean {
  if (amount > w.budget) return false;
  w.budget -= amount;
  return true;
}

export function isBankrupt(w: WorldState) {
  return w.budget < dailyCostTotal(w);
}

/** Engine-defined value: cap * (avg score / 10)^1.5 (gentle curve: a decent product is worth a decent share of the cap). The customer never sets money. */
export function customerPayment(cap: number, scores: Record<string, number>): number {
  const v = Object.values(scores);
  if (!v.length) return 0;
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.round(cap * (Math.min(10, Math.max(0, avg)) / 10) ** 1.5 * 100) / 100;
}

export type SubDecision = "subscribe" | "cancel" | "stay" | "none";
export const avgScore = (scores: Record<string, number>) => {
  const v = Object.values(scores);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};
/** Engine-side subscription rule: the customer's scores say how well its need is met; money is never the customer's call. */
export function decideSubscription(cfg: Config, subscribed: boolean, price: number, cap: number, scores: Record<string, number>): SubDecision {
  const value = customerPayment(cap, scores);
  const avg = avgScore(scores);
  if (subscribed) return avg < cfg.game.cancelAvg || price > value ? "cancel" : "stay";
  return avg >= cfg.game.subscribeAvg && price <= value ? "subscribe" : "none";
}

/** Subscribers (customer ids) in config order and the income they bring per day. */
export const subscribers = (cfg: Config, w: WorldState) => cfg.customers.filter((c) => w.subs?.[c.id] !== undefined);

const round2 = (n: number) => Math.round(n * 100) / 100;

function newId(w: WorldState, role: string) {
  const base = role.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 3) || "emp";
  let n = 1;
  while (w.employees.some((e) => e.id === `${base}${n}`) || w.product.some((p) => p.agent === `${base}${n}`)) n++;
  return `${base}${n}`;
}

export interface ActionResult { ok: boolean; type: string; reason: string }

/**
 * Engine-side judge for a manager action. The manager only proposes; money and headcount change only here.
 * Every outcome (approved or rejected) is written to the event log.
 */
export function applyAction(cfg: Config, log: EventLog, w: WorldState, day: number, a: ManagerAction): ActionResult {
  const g = cfg.game;
  const done = (ok: boolean, reason: string, payload: Record<string, unknown> = {}, target?: string): ActionResult => {
    log.append({ day, type: a.type, actor: "manager", target, payload: { ok, reason, ...payload, budget: w.budget } });
    return { ok, type: a.type, reason };
  };

  if (a.type === "hire") {
    const role = typeof a.role === "string" ? a.role.trim().slice(0, 30) : "";
    const salary = Number(a.salary);
    const personality = typeof a.personality === "string" ? a.personality.trim().slice(0, 80) : "";
    if (!role) return done(false, "missing role");
    if (!Number.isFinite(salary) || salary <= 0 || salary > g.maxSalary) return done(false, `invalid salary (1..${g.maxSalary})`, { role, salary });
    if (w.employees.length >= g.maxEmployees) return done(false, `max ${g.maxEmployees} employees`, { role, salary });
    // after paying the fee the company must still afford a full day of salaries including the new one
    if (w.budget - g.hiringFee < dailyCostTotal(w) + salary) return done(false, "cannot afford hire", { role, salary });
    charge(w, g.hiringFee);
    const id = newId(w, role);
    w.employees.push({ id, role, salary: round2(salary), personality, hiredDay: day, adapting: true });
    return done(true, "hired (adaptation day)", { role, salary, personality, fee: g.hiringFee, id }, id);
  }

  if (a.type === "set_price") {
    const price = Number(a.price);
    if (!Number.isFinite(price) || price < g.minPrice || price > g.maxPrice) return done(false, `invalid price (${g.minPrice}..${g.maxPrice})`, { price: a.price });
    w.price = round2(price);
    return done(true, "price set", { price: w.price });
  }

  if (a.type === "fire") {
    const id = typeof a.agentId === "string" ? a.agentId : "";
    if (id === "manager") return done(false, "manager cannot be fired", {}, id);
    const e = w.employees.find((x) => x.id === id);
    if (!e) return done(false, "unknown employee", {}, id);
    if (w.employees.length <= 1) return done(false, "cannot fire the last employee", {}, id);
    const severance = round2(e.salary * g.severanceDays);
    if (!charge(w, severance)) return done(false, "cannot afford severance", { severance }, id);
    w.employees = w.employees.filter((x) => x.id !== id);
    delete w.memory[id]; delete w.inbox[id]; delete w.retros[id];
    return done(true, "fired", { severance, why: typeof a.reason === "string" ? a.reason.slice(0, 120) : "" }, id);
  }

  // spend
  const amount = Number(a.amount);
  if (!Number.isFinite(amount) || amount <= 0) return done(false, "invalid amount");
  if (amount > g.spendCapPerAction) return done(false, `over per-action cap ${g.spendCapPerAction}`, { amount });
  if (w.budget - amount < dailyCostTotal(w)) return done(false, "would endanger payroll", { amount });
  const why = typeof a.reason === "string" ? a.reason.slice(0, 120) : "";
  charge(w, round2(amount));
  return done(true, "approved", { amount: round2(amount), why });
}
