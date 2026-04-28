# on-device-llm-bench

An open, reproducible benchmark for **on-device LLMs running in the browser**.
Currently compares three backends behind the same agent interface:

- **A — `gemma-tjs`** — Gemma 4 E2B via Transformers.js + WebGPU (portable runtime, smaller model)
- **B — `edge-prompt`** — Phi-4-mini via Microsoft Edge's built-in `LanguageModel` Prompt API (native runtime)
- **C — `phi4-tjs`** — Phi-4-mini via Transformers.js + WebGPU (portable runtime, same weights as B)

> **B vs C isolates the runtime** (same Phi-4 weights, different execution stack).
> **A vs C isolates the model** (same runtime, different weights).
> **A vs B** is the headline comparison most users will care about.

📊 **Live results dashboard:** https://halton.github.io/on-device-llm-bench/

## Why

On-device LLMs are arriving through two very different stacks: **portable
(Transformers.js + WebGPU)** and **browser-native (Prompt API)**. They have
different tradeoffs for accuracy, latency, memory, and developer ergonomics.
This repo runs the *same* prompts against all three configurations and publishes the numbers.

Results are device-dependent. We welcome contributed runs from other hardware
(see [Contributing results](#contributing-results)).

## Prerequisites

- **Microsoft Edge Stable ≥ 138** (tested on 147.0.3912.86)
- **Node.js ≥ 20**
- **Apple Silicon / x86-64 with WebGPU support** (Edge has WebGPU on by default)
- For the Phi-4 backend:
  - Enable `edge://flags/#prompt-api-for-phi-mini` → **Enabled**, restart Edge
  - Visit `edge://on-device-internals` and verify performance class ≥ **High**
  - Open https://microsoftedge.github.io/Demos/built-in-ai/playgrounds/prompt-api/
    once to trigger the model download (~2.3 GB)
- For the Gemma backend: ~3 GB free disk for the ONNX shards (cached in browser
  CacheStorage on first load)
- Quit any running Edge windows before using the Playwright runner — Edge holds
  an exclusive lock on its profile directory.

## What gets compared

| Backend | Model | Runtime |
|---|---|---|
| `gemma-tjs` (A) | `onnx-community/gemma-4-E2B-it-ONNX` | Transformers.js + WebGPU |
| `edge-prompt` (B) | Phi-4-mini-instruct (Edge AI service) | Edge built-in `LanguageModel` (Prompt API) |
| `phi4-tjs` (C) | `onnx-community/Phi-4-mini-instruct-ONNX-web` | Transformers.js + WebGPU |

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

### 2. Run against Gemma (Edge Stable with WebGPU)

1. Open the served URL in Edge Stable (WebGPU is on by default).
2. Select backend = **Gemma 4 / Transformers.js / WebGPU**.
3. Set "Runs per case" (default 3 — increase for tighter latency stats).
4. Click **Load model** → wait for "ready".
5. Click **Run eval** → watch the live log and aggregate table.
6. Click **Download results JSON** when complete; save into `results/`.

### 3. Run against Edge + Phi-4 (B — `edge-prompt`)

1. Use Edge Stable (≥ 138).
2. Enable `edge://flags/#prompt-api-for-phi-mini` → **Enabled**, restart.
3. Visit `edge://on-device-internals` — confirm performance class ≥ High.
4. Open the playground once to trigger model download:
   `https://microsoftedge.github.io/Demos/built-in-ai/playgrounds/prompt-api/`
5. Open the served runner URL in the same Edge profile, select backend =
   **Phi-4-mini / Edge Prompt API**, repeat steps 3–6 above.

### 4. Run against Phi-4 via Transformers.js (C — `phi4-tjs`)

1. Same browser/WebGPU prerequisites as Gemma.
2. Open the served runner URL, select backend =
   **Phi-4-mini / Transformers.js / WebGPU**.
3. First run downloads the ONNX shards (~2.4 GB) into the browser CacheStorage.
4. Repeat steps 3–6 from the Gemma section.

This backend uses the *same Phi-4 weights as B* but executes them under
`onnxruntime-web` instead of Edge's native ML runtime — useful for isolating
runtime effects from model effects.

### 5. Compare results

Each download is `{backend}-{timestamp}.json` containing per-run metrics plus
per-case aggregates (pass-rate over N, mean / p50 / p95 of TTFT and TPS). The
`score` script compares two backends at a time:

```bash
# A vs B (the headline comparison)
npm run score -- results/gemma-tjs-*.json results/edge-prompt-*.json --out results/report-AB.md

# B vs C (isolate runtime)
npm run score -- results/edge-prompt-*.json results/phi4-tjs-*.json --out results/report-BC.md

# A vs C (isolate model)
npm run score -- results/gemma-tjs-*.json results/phi4-tjs-*.json --out results/report-AC.md
```

The committed `results/<run>/report.md` files merge all three backends into a
single comparative report — see `results/20260428-macos/report.md` for the
expected format.

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

## Contributing results

The dashboard at the top of this README is fed by `results/<YYYYMMDD>-<os>/`
folders in this repo. To add a run from your machine:

1. Run all three backends per **How to run** above; download the three JSON files.
2. Score the pairs you care about (see step 5 above), or follow the existing
   `results/20260428-macos/report.md` layout to merge A/B/C into one report.
3. Create `results/<YYYYMMDD>-<os-arch>/` (e.g. `20260501-windows-x64`,
   `20260501-linux-x64`) and move the JSONs + `report.md` into it.
4. Top of `report.md` must include: host, OS, Edge version, extension version,
   model versions (see existing reports for format).
5. Update `docs/manifest.json` with an entry for your folder, including
   `gemma-tjs`, `edge-prompt`, and `phi4-tjs` keys under `models`, `json`, and
   `summary`.
6. Open a PR.

## Automated runner (Playwright) — ⚠️ not working, follow-up needed

`run-auto.mjs` was an attempt to automate both backends end-to-end via
Playwright with the `msedge` channel. **Status: does not currently work.**

- ✅ Gemma side launches and completes, but the Playwright-controlled Edge
  context behaves differently enough from a normal user session that results
  may not be representative.
- ❌ Phi-4 backend fails: the Edge AI surface refuses to initialize
  `LanguageModel.create()` under Playwright's automation posture (page crashes
  during model session creation).

**For now, run the eval manually** following the steps in **How to run**. The
script is checked in only as a starting point.

**Follow-up ideas (PRs welcome):**
- CDP-attach to a manually-launched Edge instead of letting Playwright launch it
- Investigate which `--enable-automation` / blink-features signals the Edge AI
  service uses to gate initialization
- Build a lightweight Edge extension that drives the runner page from inside a
  normal browser session
