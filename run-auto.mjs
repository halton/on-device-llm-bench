#!/usr/bin/env node
// Automates both eval runs (Gemma + Phi-4) in Edge Stable via Playwright,
// then scores them. Requires: `npm i -D playwright` in this directory.
//
// Usage: node run-auto.mjs [--runs N] [--profile-dir PATH] [--keep-vite]

import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);

const RUNS_PER_CASE = parseInt(arg('--runs', '3'), 10);
const PROFILE_DIR = arg('--profile-dir',
  path.join(os.homedir(), 'Library/Application Support/Microsoft Edge'));
const RESULTS_DIR = path.join(__dirname, 'results');
const URL = 'http://127.0.0.1:5180/runner.html';

const ONLY = arg('--only', null); // 'gemma-tjs' | 'edge-prompt' | null
const BACKENDS = [
  { id: 'gemma-tjs',   label: 'Gemma 4',   loadTimeoutMs: 600_000 },
  { id: 'edge-prompt', label: 'Phi-4-mini', loadTimeoutMs: 300_000 },
].filter(b => !ONLY || b.id === ONLY);

function preflight() {
  // Refuse if Edge is already running on this profile (would cause profile lock).
  let running = '';
  try { running = execSync('pgrep -f "Microsoft Edge.app/Contents/MacOS/Microsoft Edge" || true').toString(); } catch {}
  if (running.trim()) {
    console.error('[preflight] Microsoft Edge is currently running. Please quit Edge first (Cmd-Q) — Playwright needs an exclusive lock on the profile.');
    process.exit(2);
  }
  if (!fs.existsSync(PROFILE_DIR)) {
    console.error(`[preflight] Edge profile dir not found: ${PROFILE_DIR}`);
    process.exit(2);
  }
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  console.log(`[preflight] OK. profile=${PROFILE_DIR} runs/case=${RUNS_PER_CASE}`);
}

function startVite() {
  console.log('[vite] starting…');
  const proc = spawn('npm', ['run', 'serve'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const onData = (buf) => {
      const s = buf.toString();
      process.stdout.write(`[vite] ${s}`);
      if (s.includes('Local:') || s.includes('ready in')) {
        proc.stdout.off('data', onData);
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (b) => process.stderr.write(`[vite!] ${b}`));
    proc.on('exit', (code) => reject(new Error(`vite exited early code=${code}`)));
    setTimeout(() => reject(new Error('vite did not become ready in 30s')), 30_000);
  });
}

async function runBackend(context, backend) {
  console.log(`\n=== Backend: ${backend.id} (${backend.label}) ===`);
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[page-err] ${m.text()}`); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Sanity-check: if backend = edge-prompt, ensure LanguageModel is exposed.
  if (backend.id === 'edge-prompt') {
    const ok = await page.evaluate(() => typeof self.LanguageModel !== 'undefined');
    if (!ok) throw new Error('window.LanguageModel is not exposed in this Edge profile. Is the prompt-api-for-phi-mini flag enabled and the model downloaded?');
  }

  await page.locator(`input[name=backend][value="${backend.id}"]`).check();
  await page.locator('#runsPerCase').fill(String(RUNS_PER_CASE));

  console.log('[run] clicking Load model…');
  await page.locator('#loadBtn').click();
  await page.locator('#status').filter({ hasText: 'ready' }).waitFor({ timeout: backend.loadTimeoutMs });
  console.log('[run] model loaded');

  console.log('[run] clicking Run eval…');
  const totalCasesEstimate = 26 * RUNS_PER_CASE; // 14+5+4+3 cases
  await page.locator('#runBtn').click();
  // Wait for the log to contain "[done]" — same signal the page uses.
  await page.locator('#log').filter({ hasText: '[done] eval complete' }).waitFor({
    timeout: Math.max(20 * 60_000, totalCasesEstimate * 30_000),
  });
  const pass = await page.locator('#passCount').innerText();
  const fail = await page.locator('#failCount').innerText();
  console.log(`[run] eval complete: pass=${pass} fail=${fail}`);

  console.log('[run] downloading results JSON…');
  const dlPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('#downloadBtn').click();
  const download = await dlPromise;
  const suggested = download.suggestedFilename();
  const target = path.join(RESULTS_DIR, suggested);
  await download.saveAs(target);
  console.log(`[run] saved → ${path.relative(__dirname, target)}`);
  await page.close();
  return target;
}

async function main() {
  preflight();
  const vite = await startVite();
  let context;
  const saved = {};
  try {
    console.log('[playwright] launching Edge Stable (persistent profile)…');
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'msedge',
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    for (const backend of BACKENDS) {
      try {
        saved[backend.id] = await runBackend(context, backend);
      } catch (e) {
        console.error(`[run] ${backend.id} FAILED: ${e.message}`);
      }
    }
  } finally {
    if (context) await context.close().catch(() => {});
    if (!has('--keep-vite')) vite.kill('SIGTERM');
  }

  if (saved['gemma-tjs'] && saved['edge-prompt']) {
    const out = path.join(RESULTS_DIR, 'report.md');
    console.log(`\n[score] generating ${path.relative(__dirname, out)}`);
    execSync(`node score.mjs "${saved['gemma-tjs']}" "${saved['edge-prompt']}" --out "${out}"`,
      { cwd: __dirname, stdio: 'inherit' });
    console.log(`\n=== DONE ===\nReport: ${out}`);
  } else {
    console.error('\n=== INCOMPLETE ===\nOne or both backends failed; skipping score step.');
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
