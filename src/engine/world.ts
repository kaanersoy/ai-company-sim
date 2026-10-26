import type { Config, EmployeeSeed } from "../config.js";
import type { EventLog } from "./events.js";

export interface WorldState {
  day: number;        // last completed day (0 = not started)
  budget: number;     // in-game money
  rent?: number;      // daily office rent (from config at world creation)
  employees: EmployeeSeed[];
  stopped: string | null;
  product: { day: number; agent: string; work: string }[];   // the "product file" (capped)
  memory: Record<string, string[]>;                           // last 3 outputs per agent
  retros: Record<string, string>;                             // yesterday's retro per agent
  inbox: Record<string, string[]>;                            // messages for tomorrow
  customerQuestions: string[];                                // team questions awaiting the next review
  productSummary?: string;                                    // latest end-of-day product description (for tomorrow's summary)
  seed?: number;                                              // picks this world's product-idea inspiration
  price?: number;                                             // daily subscription price (set by the CEO, judged by the engine)
  subs?: Record<string, number>;                              // customerId -> day subscribed
  customerNotes: string[];                                    // latest customer feedback/answers (shown on the board)
}

export function loadWorld(cfg: Config, log: EventLog): WorldState {
  const base: WorldState = {
    day: 0,
    budget: cfg.game.startingBudget,
    rent: cfg.game.officeRentPerDay ?? 0,
    seed: cfg.game.seed ?? Math.floor(Math.random() * 1e9),
    price: cfg.game.startPrice,
    subs: {},
    employees: cfg.game.startingEmployees.map((e) => ({ ...e })),
    stopped: null,
    product: [], memory: {}, retros: {}, inbox: {}, customerQuestions: [], customerNotes: [],
  };
  return { ...base, ...(log.getKV<Partial<WorldState>>("world") ?? {}) };
}

export function saveWorld(log: EventLog, w: WorldState) {
  w.product = w.product.slice(-20);
  log.setKV("world", w);
}
