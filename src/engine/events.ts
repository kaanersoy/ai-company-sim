import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type EventType =
  | "daily_retro" | "daily_reply" | "plan" | "work" | "message" | "hire" | "fire"
  | "spend" | "salary" | "customer_review" | "customer_payment" | "set_price" | "subscription" | "subscription_payment" | "product_update" | "day_summary" | "day_end" | "sim_stopped";

export interface SimEvent {
  id?: number;
  day: number;
  ts?: number;
  type: EventType;
  actor?: string | null;
  target?: string | null;
  payload?: unknown;
  cost_usd?: number;
}

type Listener = (e: SimEvent & { id: number; ts: number }) => void;

/** SQLite-backed event log + key/value state. Listeners get every event (WebSocket hooks in here later). */
export class EventLog {
  readonly db: Database.Database;
  private listeners: Listener[] = [];

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day INTEGER NOT NULL, ts INTEGER NOT NULL, type TEXT NOT NULL,
        actor TEXT, target TEXT, payload TEXT, cost_usd REAL NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  onEvent(l: Listener) { this.listeners.push(l); }

  append(e: SimEvent) {
    const ts = Date.now();
    const info = this.db
      .prepare("INSERT INTO events (day, ts, type, actor, target, payload, cost_usd) VALUES (?,?,?,?,?,?,?)")
      .run(e.day, ts, e.type, e.actor ?? null, e.target ?? null, JSON.stringify(e.payload ?? null), e.cost_usd ?? 0);
    const full = { ...e, id: Number(info.lastInsertRowid), ts };
    for (const l of this.listeners) l(full);
    return full;
  }

  all(): SimEvent[] {
    return this.db.prepare("SELECT * FROM events ORDER BY id").all().map((r: any) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  getKV<T>(key: string): T | undefined {
    const r = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : undefined;
  }

  setKV(key: string, value: unknown) {
    this.db.prepare("INSERT INTO kv (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(value));
  }

  close() { this.db.close(); }
}
