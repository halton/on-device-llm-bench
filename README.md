# Eval: Gemma 4 (Transformers.js) vs Edge + Phi-4-mini

Apples-to-apples comparison of two on-device LLM backends behind the same agent
interface used by this extension.

## What gets compared

| Backend | Model | Runtime |
|---|---|---|
| `gemma-tjs` | `onnx-community/gemma-4-E2B-it-ONNX` | Transformers.js + WebGPU |
| `edge-prompt` | Phi-4-mini-instruct | Edge built-in `LanguageModel` (Prompt API) |

Both are wrapped by the same `Backend` interface (`backends/types.ts`) so the
runner does not know which one it's calling.

## Metrics captured per case

- **TTFT** — time to first token (ms)
- **TPS** — output tokens / second (steady-state)
- **Cold start** — backend load + first session create (ms; first run only)
- **Tool-call accuracy** — exact match on `tool` name + structural match on `args`
- **Grounding** — does the answer cite content present in the provided context
- **Refusal correctness** — refuses when it should, answers when it shouldn't
- **Output JSON validity** — for cases that constrain to a JSON schema

## Test case suites

| File | Cases | Purpose |
|---|---|---|
| `cases/tool-calling.json` | 14 | Pick correct tool + args from natural-language requests |
| `cases/grounding.json` | 5 | RAG: answer must come from supplied page context |
| `cases/refusal.json` | 4 | Don't fabricate when context is missing |
| `cases/multi-turn.json` | 3 | Carry context across turns |

## How to run

The runner is a browser page (`runner.html`). Both backends require browser
context — Gemma needs WebGPU, Phi-4 needs the Edge `LanguageModel` global.

This directory is its own self-contained project with its own `package.json`.

### 1. Install + serve

```bash
cd eval
npm install
npm run serve   # vite dev server on http://127.0.0.1:5180/runner.html
```

### 2. Run against Gemma (any Chromium with WebGPU)

1. Open the served URL in Chrome/Edge with WebGPU enabled.
2. Select backend = **Gemma 4 / Transformers.js / WebGPU**.
3. Set "Runs per case" (default 3 — increase for tighter latency stats).
4. Click **Load model** → wait for "ready".
5. Click **Run eval** → watch the live log and aggregate table.
6. Click **Download results JSON** when complete; save into `results/`.

### 3. Run against Edge + Phi-4

1. Install Edge Canary/Dev (≥ 138.0.3309.2).
2. Enable `edge://flags/#prompt-api-for-phi-mini` → **Enabled**, restart.
3. Visit `edge://on-device-internals` — confirm performance class ≥ High.
4. Open the playground once to trigger model download:
   `https://microsoftedge.github.io/Demos/built-in-ai/playgrounds/prompt-api/`
5. Open the served runner URL in the same Edge profile, select backend =
   **Phi-4-mini / Edge Prompt API**, repeat steps 3–6 above.

### 4. Compare results

Each download is `{backend}-{timestamp}.json` containing per-run metrics plus
per-case aggregates (pass-rate over N, mean / p50 / p95 of TTFT and TPS). To
generate a side-by-side Markdown report:

```bash
npm run score -- results/gemma-tjs-*.json results/edge-prompt-*.json --out results/report.md
```

The report includes overall accuracy, accuracy by category, latency &
throughput with winners marked, and a per-case detail table.

## Adding a case

Append to the relevant `cases/*.json`. Schema:

```json
{
  "id": "tool-001",
  "category": "tool-calling",
  "input": "close the second tab",
  "context": { "tabs": [...] },        // optional, injected as system context
  "expected": {
    "tool": "close_tab",
    "args": { "tabId": "<any-number>" }, // values matched structurally
    "mustContain": [],                   // for grounding
    "mustNotContain": [],
    "shouldRefuse": false
  },
  "constraint": null                     // or a JSON schema
}
```

## Why a browser harness instead of Node

- `LanguageModel` is only exposed in Edge browser contexts.
- Transformers.js with WebGPU needs a browser GPU adapter.
- Running both in the same page guarantees the same hardware/thermal state and
  removes Node↔browser variance.
