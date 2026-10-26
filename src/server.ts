import http from "node:http";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { loadConfig, ROOT } from "./config.js";
import { EventLog } from "./engine/events.js";
import { CostGuard } from "./engine/costGuard.js";
import { runSim } from "./engine/loop.js";
import { MockLLM } from "./llm/mock.js";
import { ClaudeClient, LLMError, loadApiKey } from "./llm/client.js";

const cfg = loadConfig();
const PORT = Number(process.env.PORT ?? 3000);
const WEB = path.join(ROOT, "web");
const THREE = path.join(ROOT, "node_modules", "three", "build");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".txt": "text/plain" };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const vendor = url.startsWith("/vendor/");
  const base = vendor ? THREE : WEB;
  const file = path.resolve(base, vendor ? url.slice(8) : url === "/" ? "index.html" : url.slice(1));
  if (!file.startsWith(base + path.sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end("not found"); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
const wss = new WebSocketServer({ server, path: "/ws" });

const hasKey = () => !process.env.SIM_MOCK && !!loadApiKey(); // SIM_MOCK=1 forces mock mode (dev/testing, $0)
let session: { log: EventLog; mock: boolean } | null = null;
let running = false;
let stopRequested = false;

const send = (ws: WebSocket, m: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
const broadcast = (m: unknown) => wss.clients.forEach((c) => send(c, m));
const dbFile = (mock: boolean) => path.resolve(ROOT, mock ? cfg.mockDbPath : cfg.dbPath);

function open(mock: boolean, fresh = false) {
  if (session?.mock === mock && !fresh) return session;
  session?.log.close();
  const f = dbFile(mock);
  if (fresh) for (const s of ["", "-wal", "-shm"]) if (existsSync(f + s)) rmSync(f + s);
  const log = new EventLog(f);
  log.onEvent((e) => broadcast({ t: "event", e }));
  return (session = { log, mock });
}

function hello(ws: WebSocket | "all") {
  const s = session!;
  const m = { t: "hello", mock: s.mock, hasKey: hasKey(), running, cap: cfg.maxSpendUsd, model: cfg.model,
    employees: cfg.game.startingEmployees, customers: cfg.customers.map((c) => ({ id: c.id, name: c.name, business: c.business })), budget: cfg.game.startingBudget, maxDays: cfg.game.maxDays,
    history: s.log.all() };
  if (ws === "all") broadcast(m); else send(ws, m);
}

async function start(opts: { mock: boolean; days: number; fresh: boolean }) {
  if (running) return;
  if (!opts.mock && !hasKey()) { broadcast({ t: "error", message: "ANTHROPIC_API_KEY not found (.env)." }); return; }
  const changed = !session || session.mock !== opts.mock || opts.fresh;
  const s = open(opts.mock, opts.fresh);
  if (changed) hello("all");
  running = true; stopRequested = false; broadcast({ t: "running", running });
  const guard = new CostGuard(cfg, s.log, opts.mock ? new MockLLM() : ClaudeClient.fromEnv(cfg.model));
  let result: { daysRun: number; stopped: string | null; spentUsd: number };
  try { result = await runSim(cfg, s.log, guard, opts.days, () => stopRequested); }
  catch (err) {
    broadcast({ t: "error", message: err instanceof LLMError ? err.message : String(err) });
    result = { daysRun: 0, stopped: "error", spentUsd: guard.spentUsd };
  }
  running = false;
  broadcast({ t: "done", ...result, calls: guard.calls, remaining: guard.remainingUsd });
  broadcast({ t: "running", running });
  if (result.stopped === "user") hello("all"); // clients drop in-flight events on stop: resync them from the log
}

wss.on("connection", (ws) => {
  session ??= open(!hasKey());
  hello(ws);
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(String(raw));
      if (m.cmd === "start") void start({ mock: !!m.mock, days: Math.min(30, Math.max(1, Number(m.days) || 5)), fresh: !!m.fresh });
      else if (m.cmd === "addBudget") { cfg.maxSpendUsd = Math.round((cfg.maxSpendUsd + 0.2) * 100) / 100; broadcast({ t: "cap", cap: cfg.maxSpendUsd }); } // session only: config.json is untouched
      else if (m.cmd === "stop") stopRequested = true;
      else if (m.cmd === "reset" && !running) { open(session!.mock, true); hello("all"); }
      else if (m.cmd === "mode" && !running) { open(!!m.mock); hello("all"); }
    } catch { /* ignore malformed */ }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`UI: http://localhost:${PORT}`));
