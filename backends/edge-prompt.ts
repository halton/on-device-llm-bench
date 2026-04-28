import type { Backend, GenerateOptions, GenerateResult, ToolCall } from './types';
import { TOOL_SYSTEM_PROMPT, parseToolCall } from './tool-prompt';

// Edge built-in Prompt API (Phi-4-mini-instruct).
// Requires Edge Canary/Dev with `edge://flags/#prompt-api-for-phi-mini` enabled.

declare const LanguageModel: any;

export class EdgePromptBackend implements Backend {
  id = 'edge-prompt' as const;
  private session: any = null;

  async init(onProgress?: (pct: number) => void): Promise<number> {
    if (typeof LanguageModel === 'undefined') {
      throw new Error('LanguageModel global not present. Enable Prompt API in edge://flags.');
    }
    const t0 = performance.now();
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new Error('Prompt API reports model unavailable on this device.');
    }
    this.session = await LanguageModel.create({
      monitor: (m: any) => {
        m.addEventListener('downloadprogress', (e: any) => {
          if (onProgress) onProgress((e.loaded / e.total) * 100);
        });
      },
    });
    return performance.now() - t0;
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<GenerateResult> {
    return this.runOnce(
      [
        { role: 'system', content: opts.systemPrompt ?? TOOL_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      opts,
    );
  }

  async chat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts: GenerateOptions = {},
  ): Promise<GenerateResult> {
    return this.runOnce(messages, opts);
  }

  private async runOnce(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts: GenerateOptions,
  ): Promise<GenerateResult> {
    if (!this.session) throw new Error('Backend not initialized');
    // Phi-4 in Prompt API requires system prompt at index 0 only.
    const systemMsg = messages.find((m) => m.role === 'system');
    const conv = messages.filter((m) => m.role !== 'system');

    // Clone a fresh session per generate so we don't leak state across cases.
    const session = await this.session.clone();
    if (systemMsg) {
      // Re-create with system prompt because clone preserves the existing one.
      session.destroy();
      var s = await LanguageModel.create({
        initialPrompts: [{ role: 'system', content: systemMsg.content }],
      });
    } else {
      var s = session;
    }

    const promptArg =
      conv.length === 1 && conv[0].role === 'user'
        ? conv[0].content
        : (conv as any[]);

    const t0 = performance.now();
    let firstTokenAt = 0;
    let outText = '';
    let outputTokens = 0;
    const stream = s.promptStreaming(promptArg, {
      responseConstraint: opts.jsonSchema,
      signal: opts.signal,
    });
    for await (const chunk of stream) {
      if (!firstTokenAt) firstTokenAt = performance.now();
      outText += chunk;
      outputTokens += approxTokens(chunk);
    }
    const t1 = performance.now();
    s.destroy();

    const totalMs = t1 - t0;
    const ttftMs = firstTokenAt ? firstTokenAt - t0 : totalMs;
    const tps = outputTokens / Math.max(0.001, (t1 - firstTokenAt) / 1000);

    let toolCall: ToolCall | undefined;
    try {
      toolCall = parseToolCall(outText);
    } catch {
      /* not a tool call */
    }
    return { text: outText, toolCall, ttftMs, totalMs, outputTokens, tps };
  }

  async reset(): Promise<void> {
    if (this.session) {
      this.session.destroy();
      this.session = await LanguageModel.create();
    }
  }

  async dispose(): Promise<void> {
    if (this.session) this.session.destroy();
    this.session = null;
  }
}

function approxTokens(s: string): number {
  // Rough: 1 token ≈ 4 chars. Good enough for TPS comparison.
  return Math.max(1, Math.round(s.length / 4));
}
