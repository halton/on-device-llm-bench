export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface GenerateOptions {
  systemPrompt?: string;
  jsonSchema?: object;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  toolCall?: ToolCall;
  ttftMs: number;
  totalMs: number;
  outputTokens: number;
  tps: number;
}

export interface Backend {
  id: 'gemma-tjs' | 'edge-prompt' | 'phi4-tjs';
  /** One-time setup: download/load model, warm up. Returns ms taken. */
  init(onProgress?: (pct: number) => void): Promise<number>;
  /** Single-turn generation. */
  generate(prompt: string, opts?: GenerateOptions): Promise<GenerateResult>;
  /** Multi-turn: each call appends to internal session state. */
  chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
       opts?: GenerateOptions): Promise<GenerateResult>;
  /** Reset chat session. */
  reset(): Promise<void>;
  /** Free resources. */
  dispose(): Promise<void>;
}

export interface TestCase {
  id: string;
  category: 'tool-calling' | 'grounding' | 'refusal' | 'multi-turn';
  input: string | Array<{ role: 'user' | 'assistant'; content: string }>;
  context?: Record<string, unknown>;
  expected: {
    tool?: string;
    args?: Record<string, unknown>;
    mustContain?: string[];
    mustNotContain?: string[];
    shouldRefuse?: boolean;
  };
  constraint?: object | null;
}

export interface CaseResult {
  caseId: string;
  backendId: Backend['id'];
  passed: boolean;
  reasons: string[];
  metrics: {
    ttftMs: number;
    totalMs: number;
    outputTokens: number;
    tps: number;
  };
  rawOutput: string;
  parsedToolCall?: ToolCall;
}
