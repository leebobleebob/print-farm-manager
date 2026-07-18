#!/usr/bin/env node
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/Users/leebob/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}

const url = process.argv[2] || 'http://100.125.73.7:8765/centauri-sentry-next/';
const outputDir = path.resolve(process.argv[3] || 'verification/fleet-send-preview-interaction');
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const summary = { url, checkedAt: new Date().toISOString(), surfaces: [], consoleErrors: [], pageErrors: [], failedRequests: [] };

for (const surface of [
  { name: 'desktop', viewport: { width: 1440, height: 1000 }, touch: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, touch: true },
]) {
  const context = await browser.newContext({ viewport: surface.viewport, hasTouch: surface.touch, isMobile: surface.touch });
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') summary.consoleErrors.push(`${surface.name}: ${message.text()}`); });
  page.on('pageerror', (error) => summary.pageErrors.push(`${surface.name}: ${error.message}`));
  page.on('response', (response) => { if (response.status() >= 400) summary.failedRequests.push(`${surface.name}: ${response.status()} ${response.url()}`); });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Preflight selected printers' }).click();
  const dialog = page.getByRole('dialog', { name: /Resolve 1 existing file/ });
  await dialog.waitFor({ state: 'visible' });
  await page.screenshot({ path: path.join(outputDir, `${surface.name}-duplicate-hud.png`), fullPage: true });

  await dialog.getByRole('button', { name: 'Replace' }).click();
  await dialog.getByRole('button', { name: 'Continue with decisions' }).click();
  await page.getByRole('button', { name: 'Confirm upload & print' }).click();
  await page.getByRole('heading', { name: 'Fleet Send complete' }).waitFor({ state: 'visible', timeout: 8000 });
  await page.screenshot({ path: path.join(outputDir, `${surface.name}-complete.png`), fullPage: true });

  const state = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    complete: document.body.innerText.includes('Fleet Send complete'),
    frankStarted: document.body.innerText.includes('Frank') && document.body.innerText.includes('Print started'),
    mismatchVisible: document.body.innerText.includes('PETG') && document.body.innerText.includes('PLA is required'),
    demoBanner: document.body.innerText.includes('NO PRINTER COMMANDS ARE SENT'),
  }));
  summary.surfaces.push({ ...surface, state });
  await context.close();
}

await browser.close();
await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));

const failed = summary.consoleErrors.length || summary.pageErrors.length || summary.failedRequests.length || summary.surfaces.some(({ state }) => (
  state.scrollWidth > state.width || !state.complete || !state.frankStarted || !state.mismatchVisible || !state.demoBanner
));
console.log(JSON.stringify(summary, null, 2));
if (failed) process.exit(1);
