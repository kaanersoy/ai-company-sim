import type { Config } from "../config.js";
import type { CostGuard } from "../engine/costGuard.js";
import { buildBoard, memoryOf, takeInbox } from "../engine/memory.js";
import type { WorldState } from "../engine/world.js";
import { pickIdea } from "../engine/ideas.js";
import { MANAGER_SYSTEM, workerSystem } from "./roles.js";
import { validateManager, validateWorker, type ManagerOutput, type WorkerOutput } from "./tools.js";

export async function runManager(cfg: Config, guard: CostGuard, w: WorldState, day: number) {
  const ids = w.employees.map((e) => e.id);
  const retros = ids.map((id) => `${id}: ${w.retros[id] ?? "(none yet)"}`).join("\n");
  const r = await guard.call({
    kind: "manager", actor: "manager", day, maxTokens: cfg.maxTokens.manager, system: MANAGER_SYSTEM,
    prompt: `${buildBoard(w, day)}\nYesterday's retros:\n${retros}\n${ids.length ? "" : `You have no employees yet. Inspiration for the product domain (take it unless you have a better idea): ${pickIdea(w.seed ?? 0).pitch}. Hire only the people that product truly needs (one is fine). `}Respond with reply + plan for: ${ids.join(", ")}.`,
  });
  return { out: validateManager(r.text, ids) as ManagerOutput, costUsd: r.costUsd };
}

export async function runWorker(cfg: Config, guard: CostGuard, w: WorldState, day: number, id: string, task: string) {
  const emp = w.employees.find((e) => e.id === id)!;
  const ids = w.employees.map((e) => e.id);
  const inbox = takeInbox(w, id);
  const r = await guard.call({
    kind: "worker", actor: id, day, maxTokens: cfg.maxTokens.worker, system: workerSystem(emp.role),
    prompt:
      `${buildBoard(w, day)}\nYour recent outputs:\n${memoryOf(w, id)}\n` +
      `${inbox.length ? `Messages:\n${inbox.join("\n")}\n` : ""}TODAY'S TASK: ${task}\nColleagues: ${ids.filter((x) => x !== id).join(", ")}. To ask the customer a question, message to "customer".`,
  });
  return { out: validateWorker(r.text, [...ids, "customer"]) as WorkerOutput, costUsd: r.costUsd };
}
