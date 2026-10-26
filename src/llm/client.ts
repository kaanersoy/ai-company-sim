import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";
import { MANAGER_TOOL, WORKER_TOOL } from "../agents/tools.js";
import { CUSTOMER_TOOL } from "../agents/customer.js";
import { SUMMARY_TOOL } from "../agents/summary.js";
import type { CallKind, LLMClient, LLMRequest, LLMResponse } from "./types.js";

const TOOLS = { manager: MANAGER_TOOL, worker: WORKER_TOOL, customer: CUSTOMER_TOOL, summary: SUMMARY_TOOL } as const;

/** Tool definitions + the forced-tool system prompt are billed as input but are not in req.system/prompt. */
const TOOL_PROMPT_OVERHEAD_CHARS = 1200;

export class LLMError extends Error {}

/** Loads ANTHROPIC_API_KEY from the environment, or from .env (never logged). */
export function loadApiKey(envFile = path.join(ROOT, ".env")): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (!existsSync(envFile)) return undefined;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.*?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "") || undefined;
  }
  return undefined;
}

/** The slice of the SDK we use; tests inject a stub. */
export interface MessagesApi {
  create(body: any): Promise<{ content: any[]; usage: { input_tokens: number; output_tokens: number } }>;
}

/** Real client: forced tool use, returns the tool input as JSON text for the engine validators. */
export class ClaudeClient implements LLMClient {
  constructor(private model: string, private api: MessagesApi) {}

  static fromEnv(model: string): ClaudeClient {
    const apiKey = loadApiKey();
    if (!apiKey) throw new LLMError("ANTHROPIC_API_KEY is not set (env var or .env file).");
    return new ClaudeClient(model, new Anthropic({ apiKey, maxRetries: 1 }).messages as unknown as MessagesApi);
  }

  overheadChars(req: LLMRequest) {
    return JSON.stringify(TOOLS[req.kind as CallKind]).length + TOOL_PROMPT_OVERHEAD_CHARS;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const tool = TOOLS[req.kind];
    let res;
    try {
      res = await this.api.create({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw new LLMError(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
      throw err;
    }
    const block = res.content.find((b) => b.type === "tool_use");
    const text = block ? JSON.stringify(block.input) : res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }
}
