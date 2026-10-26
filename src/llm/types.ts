export type CallKind = "manager" | "worker" | "customer" | "summary";

export interface LLMRequest {
  kind: CallKind;
  actor: string;
  system: string;
  prompt: string;
  maxTokens: number;
  day: number;
}

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LLMClient {
  /** Extra billed input chars not visible in the request (tool schemas etc.); counted in the worst case. */
  overheadChars?(req: LLMRequest): number;
  complete(req: LLMRequest): Promise<LLMResponse>;
}
