/** Tool schemas (Anthropic tool-use format, used by the real client in Phase 4) + engine-side validators. */
export const MANAGER_TOOL = {
  name: "daily_decision",
  description: "CEO's daily review: short reply, a task per employee, optional actions.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "Max 40 words, shown in #daily" },
      plan: { type: "object", additionalProperties: { type: "string" }, description: "employeeId -> one-sentence task" },
      actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { enum: ["hire", "fire", "spend", "set_price"] },
            role: { type: "string" }, personality: { type: "string" }, salary: { type: "number" },
            agentId: { type: "string" }, amount: { type: "number" }, price: { type: "number", description: "set_price: daily subscription price per customer" }, reason: { type: "string" },
          },
          required: ["type"],
        },
      },
    },
    required: ["reply", "plan"],
  },
} as const;

export const WORKER_TOOL = {
  name: "daily_work",
  description: "Employee's daily output.",
  input_schema: {
    type: "object",
    properties: {
      work: { type: "string", description: "What you produced, max 40 words" },
      retro: { type: "string", description: "One line: what went well / badly today" },
      message: {
        type: "object",
        properties: { to: { type: "string" }, text: { type: "string" } },
        required: ["to", "text"],
      },
    },
    required: ["work", "retro"],
  },
} as const;

export interface ManagerAction {
  type: "hire" | "fire" | "spend" | "set_price";
  role?: string; personality?: string; salary?: number; agentId?: string; amount?: number; price?: number; reason?: string;
}
export interface ManagerOutput { reply: string; plan: Record<string, string>; actions: ManagerAction[] }
export interface WorkerOutput { work: string; retro: string; message?: { to: string; text: string } }

const str = (v: unknown, max: number, d = "") => (typeof v === "string" ? v.trim().slice(0, max) : d);

/** Tolerant JSON extraction (code fences, leading text). Returns null if nothing parseable. */
export function extractJson(text: string): Record<string, any> | null {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export function validateManager(text: string, employeeIds: string[]): ManagerOutput {
  const j = extractJson(text) ?? {};
  const plan: Record<string, string> = {};
  for (const id of employeeIds) plan[id] = str(j.plan?.[id], 160, "Continue previous work.");
  const actions: ManagerAction[] = Array.isArray(j.actions)
    ? j.actions.filter((a: any) => a && ["hire", "fire", "spend", "set_price"].includes(a.type)).slice(0, 4)
    : [];
  return { reply: str(j.reply, 300, text.slice(0, 200)), plan, actions };
}

export function validateWorker(text: string, employeeIds: string[]): WorkerOutput {
  const j = extractJson(text) ?? {};
  const out: WorkerOutput = { work: str(j.work, 300, text.slice(0, 200)), retro: str(j.retro, 160, "no retro") };
  if (j.message && typeof j.message.to === "string" && employeeIds.includes(j.message.to)) {
    out.message = { to: j.message.to, text: str(j.message.text, 200) };
  }
  return out;
}
