import type { Config } from "../config.js";
import type { EventLog } from "./events.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../llm/types.js";

export class BudgetExceeded extends Error {
  constructor(public spent: number, public worstCase: number, public cap: number) {
    super(`budget: spent $${spent.toFixed(6)} + worst case $${worstCase.toFixed(6)} > cap $${cap}`);
  }
}

/**
 * The only path to an LLM. Before each call it computes the worst-case cost
 * (estimated input tokens + max_tokens); if spent + worst case > cap, no call is made.
 * Spend is persisted after every call, so restarts resume with the real total.
 */
export class CostGuard {
  private spent: number;
  calls: number;

  constructor(private cfg: Config, private log: EventLog, private llm: LLMClient) {
    this.spent = log.getKV<number>("spentUsd") ?? 0;
    this.calls = log.getKV<number>("calls") ?? 0;
  }

  get spentUsd() { return this.spent; }
  get remainingUsd() { return Math.max(0, this.cfg.maxSpendUsd - this.spent); }

  usd(inputTokens: number, outputTokens: number) {
    const p = this.cfg.pricesPerMTok;
    return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
  }

  worstCase(req: LLMRequest) {
    const chars = req.system.length + req.prompt.length + (this.llm.overheadChars?.(req) ?? 0);
    const inTok = Math.ceil(chars / this.cfg.charsPerTokenEstimate);
    return this.usd(inTok, req.maxTokens);
  }

  async call(req: LLMRequest): Promise<LLMResponse & { costUsd: number }> {
    const worst = this.worstCase(req);
    // tiny epsilon only guards float noise; it never lets a call exceed the cap
    if (this.spent + worst > this.cfg.maxSpendUsd + 1e-12) {
      throw new BudgetExceeded(this.spent, worst, this.cfg.maxSpendUsd);
    }
    const res = await this.llm.complete(req);
    const costUsd = this.usd(res.inputTokens, res.outputTokens);
    this.spent += costUsd;
    this.calls += 1;
    this.log.setKV("spentUsd", this.spent);
    this.log.setKV("calls", this.calls);
    return { ...res, costUsd };
  }
}
