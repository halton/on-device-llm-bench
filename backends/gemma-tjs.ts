import type { Backend, GenerateOptions, GenerateResult, ToolCall } from './types';
import { TOOL_SYSTEM_PROMPT, parseToolCall } from './tool-prompt';

// Gemma 4 via @huggingface/transformers (WebGPU).
// Mirrors the model setup used by the extension's background agent.

const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';

export class GemmaTjsBackend implements Backend {
  id = 'gemma-tjs' as const;
  private generator: any = null;
  private tokenizer: any = null;
  private history: Array<{ role: string; content: string }> = [];

  async init(onProgress?: (pct: number) => void): Promise<number> {
    const t0 = performance.now();
    const tjs: any = await import('@huggingface/transformers');
    this.tokenizer = await tjs.AutoTokenizer.from_pretrained(MODEL_ID, {
      progress_callback: (p: any) => {
        if (onProgress && p.status === 'progress') onProgress(p.progress ?? 0);
      },
    });
    this.generator = await tjs.AutoModelForCausalLM.from_pretrained(MODEL_ID, {
      dtype: 'q4f16',
      device: 'webgpu',
      progress_callback: (p: any) => {
        if (onProgress && p.status === 'progress') onProgress(p.progress ?? 0);
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
    messages: Array<{ role: string; content: string }>,
    opts: GenerateOptions,
  ): Promise<GenerateResult> {
    if (!this.generator || !this.tokenizer) throw new Error('Backend not initialized');

    const inputs = this.tokenizer.apply_chat_template(messages, {
      add_generation_prompt: true,
      return_dict: true,
    });

    const tjs: any = await import('@huggingface/transformers');
    const stopper = new tjs.InterruptableStoppingCriteria();
    if (opts.signal) opts.signal.addEventListener('abort', () => stopper.interrupt());

    const t0 = performance.now();
    let firstTokenAt = 0;
    let outputTokens = 0;
    let outText = '';

    const streamer = new tjs.TextStreamer(this.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk: string) => {
        if (!firstTokenAt) firstTokenAt = performance.now();
        outText += chunk;
        outputTokens++;
      },
    });

    await this.generator.generate({
      ...inputs,
      max_new_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.7,
      do_sample: (opts.temperature ?? 0.7) > 0,
      streamer,
      stopping_criteria: stopper,
    });

    const t1 = performance.now();
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
    this.history = [];
  }

  async dispose(): Promise<void> {
    this.generator = null;
    this.tokenizer = null;
    this.history = [];
  }
}
