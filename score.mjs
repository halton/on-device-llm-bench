#!/usr/bin/env node
// Reads two results JSON files (one per backend) and emits a comparative Markdown report.
// Usage: node score.mjs results/gemma-tjs-*.json results/edge-prompt-*.json [--out report.md]

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : 'results/report.md';
const files = args.filter((a, i) => a !== '--out' && (outIdx < 0 || (i !== outIdx && i !== outIdx + 1)));
if (files.length !== 2) {
  console.error('Usage: node score.mjs <fileA.json> <fileB.json> [--out report.md]');
  process.exit(1);
}

const [A, B] = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
function summarize(r) {
  const runs = r.runs;
  const byCat = {};
  for (const run of runs) {
    const cat = caseCategory(run.caseId);
    byCat[cat] ??= { n: 0, pass: 0, ttfts: [], tps: [], totals: [] };
    const b = byCat[cat];
    b.n++; if (run.passed) b.pass++;
    b.ttfts.push(run.metrics.ttftMs);
    b.tps.push(run.metrics.tps);
    b.totals.push(run.metrics.totalMs);
  }
  const overall = {
    n: runs.length,
    pass: runs.filter(r => r.passed).length,
    passCoerced: runs.filter(r => (r.passedCoerced ?? r.passed)).length,
  };
  return { backendId: r.backendId, byCat, overall };
}
function caseCategory(id) {
  if (id.startsWith('tc-')) return 'tool-calling';
  if (id.startsWith('gr-')) return 'grounding';
  if (id.startsWith('rf-')) return 'refusal';
  if (id.startsWith('mt-')) return 'multi-turn';
  return 'other';
}
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function pct(xs, p) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
function fmtPct(num, den) { return den ? `${(100 * num / den).toFixed(1)}%` : 'n/a'; }

const sa = summarize(A), sb = summarize(B);
const cats = Array.from(new Set([...Object.keys(sa.byCat), ...Object.keys(sb.byCat)])).sort();

let md = `# On-Device LLM Eval — Comparative Report\n\n`;
md += `- **A:** \`${sa.backendId}\` — source: \`${path.basename(files[0])}\`\n`;
md += `- **B:** \`${sb.backendId}\` — source: \`${path.basename(files[1])}\`\n`;
md += `- Generated: ${new Date().toISOString()}\n\n`;

md += `## Overall accuracy\n\n`;
md += `| Backend | Runs | Pass (raw) | Pass-rate (raw) | Pass (coerced) | Pass-rate (coerced) |\n|---|---:|---:|---:|---:|---:|\n`;
md += `| ${sa.backendId} | ${sa.overall.n} | ${sa.overall.pass} | ${fmtPct(sa.overall.pass, sa.overall.n)} | ${sa.overall.passCoerced} | ${fmtPct(sa.overall.passCoerced, sa.overall.n)} |\n`;
md += `| ${sb.backendId} | ${sb.overall.n} | ${sb.overall.pass} | ${fmtPct(sb.overall.pass, sb.overall.n)} | ${sb.overall.passCoerced} | ${fmtPct(sb.overall.passCoerced, sb.overall.n)} |\n\n`;
md += `> "coerced" applies post-parse type coercion (e.g. \`"12"\` → \`12\`) before comparing against expected args. This is a methodology variant; raw is the unmodified model output.\n\n`;

md += `## Accuracy by category\n\n`;
md += `| Category | ${sa.backendId} | ${sb.backendId} | Winner |\n|---|---:|---:|:---:|\n`;
for (const c of cats) {
  const a = sa.byCat[c], b = sb.byCat[c];
  const aRate = a ? a.pass / a.n : 0, bRate = b ? b.pass / b.n : 0;
  const winner = aRate > bRate ? 'A' : bRate > aRate ? 'B' : '=';
  md += `| ${c} | ${a ? fmtPct(a.pass, a.n) : '—'} | ${b ? fmtPct(b.pass, b.n) : '—'} | ${winner} |\n`;
}

md += `\n## Latency & throughput\n\n`;
md += `| Metric | ${sa.backendId} | ${sb.backendId} | Winner |\n|---|---:|---:|:---:|\n`;
const allA = Object.values(sa.byCat), allB = Object.values(sb.byCat);
const ttftA = allA.flatMap(b => b.ttfts), ttftB = allB.flatMap(b => b.ttfts);
const tpsA = allA.flatMap(b => b.tps), tpsB = allB.flatMap(b => b.tps);
const totA = allA.flatMap(b => b.totals), totB = allB.flatMap(b => b.totals);
const cmpLow = (x, y) => x < y ? 'A' : y < x ? 'B' : '=';
const cmpHigh = (x, y) => x > y ? 'A' : y > x ? 'B' : '=';
md += `| TTFT mean (ms) | ${mean(ttftA).toFixed(0)} | ${mean(ttftB).toFixed(0)} | ${cmpLow(mean(ttftA), mean(ttftB))} |\n`;
md += `| TTFT p95 (ms) | ${pct(ttftA, 0.95).toFixed(0)} | ${pct(ttftB, 0.95).toFixed(0)} | ${cmpLow(pct(ttftA, 0.95), pct(ttftB, 0.95))} |\n`;
md += `| Total mean (ms) | ${mean(totA).toFixed(0)} | ${mean(totB).toFixed(0)} | ${cmpLow(mean(totA), mean(totB))} |\n`;
md += `| Throughput mean (tok/s) | ${mean(tpsA).toFixed(1)} | ${mean(tpsB).toFixed(1)} | ${cmpHigh(mean(tpsA), mean(tpsB))} |\n`;

md += `\n## Per-case detail\n\n`;
md += `| Case | A pass | A TTFT | A TPS | B pass | B TTFT | B TPS |\n|---|:---:|---:|---:|:---:|---:|---:|\n`;
const allCases = Array.from(new Set([...A.runs, ...B.runs].map(r => r.caseId))).sort();
for (const id of allCases) {
  const ar = A.runs.filter(r => r.caseId === id);
  const br = B.runs.filter(r => r.caseId === id);
  const ap = ar.length ? `${ar.filter(r => r.passed).length}/${ar.length}` : '—';
  const bp = br.length ? `${br.filter(r => r.passed).length}/${br.length}` : '—';
  const at = ar.length ? mean(ar.map(r => r.metrics.ttftMs)).toFixed(0) : '—';
  const bt = br.length ? mean(br.map(r => r.metrics.ttftMs)).toFixed(0) : '—';
  const ats = ar.length ? mean(ar.map(r => r.metrics.tps)).toFixed(1) : '—';
  const bts = br.length ? mean(br.map(r => r.metrics.tps)).toFixed(1) : '—';
  md += `| ${id} | ${ap} | ${at} | ${ats} | ${bp} | ${bt} | ${bts} |\n`;
}

md += `\n## Notes\n\n`;
md += `- TTFT = time-to-first-token. Lower is better.\n`;
md += `- TPS = output tokens per second after first token. Higher is better.\n`;
md += `- Tool-calling and multi-turn cases use JSON-schema constrained output where supported.\n`;
md += `- Edge Prompt API token counts are approximated (≈4 chars/token); Transformers.js counts are exact.\n`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md);
console.log(`Wrote ${outPath}`);
