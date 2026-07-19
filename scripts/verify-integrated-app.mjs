import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/Users/leebob/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}

const url = process.argv[2] || 'http://100.125.73.7:8765/centauri-sentry-next/';
const outputDir = path.resolve(process.argv[3] || 'verification/integrated-app-workflow');
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const errors = { console: [], page: [], requests: [] };

async function attachDiagnostics(page) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  page.on('pageerror', (error) => errors.page.push(error.message));
  page.on('requestfailed', (request) => errors.requests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
}

const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await attachDiagnostics(desktop);
await desktop.goto(url, { waitUntil: 'networkidle' });
await desktop.getByText('Fleet Status', { exact: true }).waitFor();
for (const printer of ['7of9', 'AlmostPerfect', 'Bento', 'Dingbat', 'Frank', 'NewYeller', 'Newish', 'NoGlass']) {
  await desktop.getByText(printer, { exact: true }).waitFor();
}
await desktop.getByRole('link', { name: 'Fleet Send', exact: true }).click();
await desktop.getByRole('heading', { name: 'Fleet Send', exact: true }).waitFor();
await desktop.getByRole('link', { name: 'Decommissioned', exact: true }).click();
await desktop.getByText('CC2 Closet', { exact: true }).waitFor();
await desktop.screenshot({ path: path.join(outputDir, 'desktop-decommissioned.png'), fullPage: true });

const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
await attachDiagnostics(mobile);
await mobile.goto(url, { waitUntil: 'networkidle' });
await mobile.getByText('Fleet Status', { exact: true }).waitFor();

const mobileLayout = await mobile.evaluate(() => {
  const header = document.querySelector('[data-testid="dashboard-header"]');
  const statCards = [...document.querySelectorAll('[data-testid="dashboard-stat-card"]')];
  const viewportWidth = document.documentElement.clientWidth;
  const insideViewport = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= viewportWidth && rect.width > 0;
  };
  return {
    viewportWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headerInsideViewport: insideViewport(header),
    statCards: statCards.length,
    statCardsInsideViewport: statCards.every(insideViewport),
  };
});

if (!mobileLayout.headerInsideViewport) throw new Error('Mobile command-center header is clipped');
if (mobileLayout.statCards !== 4) throw new Error(`Expected 4 mobile stat cards, found ${mobileLayout.statCards}`);
if (!mobileLayout.statCardsInsideViewport) throw new Error('One or more mobile stat cards are clipped');
if (mobileLayout.scrollWidth !== mobileLayout.viewportWidth) throw new Error('Mobile page has horizontal overflow');

await mobile.getByRole('link', { name: 'Fleet Send', exact: true }).click();
await mobile.getByRole('heading', { name: 'Fleet Send', exact: true }).waitFor();
await mobile.screenshot({ path: path.join(outputDir, 'mobile-fleet-send.png'), fullPage: true });

if (errors.console.length || errors.page.length || errors.requests.length) {
  throw new Error(JSON.stringify(errors, null, 2));
}

const summary = { url, checkedAt: new Date().toISOString(), mobileLayout, errors };
fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
