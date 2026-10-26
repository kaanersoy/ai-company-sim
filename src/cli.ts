import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { EventLog } from "./engine/events.js";
import { CostGuard } from "./engine/costGuard.js";
import { runSim } from "./engine/loop.js";
import { MockLLM } from "./llm/mock.js";
import { ClaudeClient, LLMError } from "./llm/client.js";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const val = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const cfg = loadConfig();
const mock = flag("mock");
const cap = val("cap");
if (cap) cfg.maxSpendUsd = Number(cap);

const dbFile = path.resolve(ROOT, mock ? cfg.mockDbPath : cfg.dbPath);
if (flag("fresh")) for (const s of ["", "-wal", "-shm"]) if (existsSync(dbFile + s)) rmSync(dbFile + s);

const log = new EventLog(dbFile);
let llm;
try { llm = mock ? new MockLLM() : ClaudeClient.fromEnv(cfg.model); }
catch (err) { console.error((err as Error).message); process.exit(1); }
const guard = new CostGuard(cfg, log, llm);

let res;
try { res = await runSim(cfg, log, guard, Number(val("days", "5"))); }
catch (err) {
  if (!(err instanceof LLMError)) throw err;
  console.error(`LLM error, run aborted: ${err.message}`);
  res = { daysRun: 0, stopped: "llm_error", spentUsd: guard.spentUsd };
}

const calls = guard.calls;
console.log(`--- cost report (${mock ? "simulated, mock" : `REAL, ${cfg.model}`}) ---`);
console.log(`days run: ${res.daysRun}  stop reason: ${res.stopped ?? "none (days limit)"}`);
console.log(`calls: ${calls}  spent: $${res.spentUsd.toFixed(6)} / cap $${cfg.maxSpendUsd}  (remaining $${guard.remainingUsd.toFixed(6)})`);
console.log(`avg per call: $${calls ? (res.spentUsd / calls).toFixed(6) : "0"}`);
console.log(`events: ${log.all().length}  db: ${dbFile}`);
log.close();
