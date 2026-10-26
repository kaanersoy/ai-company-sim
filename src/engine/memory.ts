import type { WorldState } from "./world.js";
import { dailyCostTotal, dailySalaryTotal } from "./rules.js";

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

/** Engine-built shared board (~<300 tokens). No LLM involved. */
export function buildBoard(w: WorldState, day: number): string {
  const product = w.product.slice(-4).map((p) => `d${p.day} ${p.agent}: ${clip(p.work, 80)}`).join("\n") || "(empty)";
  const team = w.employees.map((e) => `${e.id}:${e.role} $${e.salary}/day`).join(", ") || "(nobody yet)";
  const notes = w.customerNotes.length ? `\nCustomer says: ${w.customerNotes.slice(-2).map((n) => clip(n, 120)).join(" | ")}` : "";
  return clip(`Day ${day}. Cash ${w.budget}. Daily costs ${dailyCostTotal(w)} (salaries ${dailySalaryTotal(w)} + rent ${w.rent ?? 0}), cash lasts ~${dailyCostTotal(w) ? Math.floor(w.budget / dailyCostTotal(w)) : "∞"} days without income. Subscription price ${w.price ?? 0}/day, ${Object.keys(w.subs ?? {}).length} subscribers (${Object.keys(w.subs ?? {}).join(", ") || "none"}). Team: ${team}.${notes}\nProduct so far:\n${product}`, 1100);
}

/** Rolling memory: last 3 outputs of one agent. */
export function memoryOf(w: WorldState, id: string): string {
  const m = w.memory[id] ?? [];
  return m.length ? m.map((x) => `- ${clip(x, 100)}`).join("\n") : "(none)";
}

export function remember(w: WorldState, id: string, line: string) {
  const m = (w.memory[id] ??= []);
  m.push(line);
  if (m.length > 3) m.splice(0, m.length - 3);
}

export function takeInbox(w: WorldState, id: string): string[] {
  const msgs = w.inbox[id] ?? [];
  delete w.inbox[id];
  return msgs;
}
