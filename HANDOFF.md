# Local Fork Handoff

## Current state

The GitHub fork exists at `https://github.com/leebobleebob/print-farm-manager` and is cloned at `/Users/leebob/Documents/Codex Project Files/print-farm-manager`. The working branch is `codex/sentry-fleet-dispatch`; `origin` points to Lee's fork and `upstream` points to Joel Telling's repository with push disabled.

Centauri Sentry was preserved separately at `/Users/leebob/Documents/Codex Project Files/centauri-farm-manager`, commit `921901e`, tag `archive/centauri-sentry-2026-07-18`. Its installed dashboard remains the live fallback. No printer-control or Dell connector mutation occurred during the fork setup.

## Verified baseline

- Node 22.23.1 installed via Homebrew as keg-only `node@22`.
- Temporary build clone: `/tmp/print-farm-manager-build.RGcssi/repo`.
- `npm ci`: passed with zero reported vulnerabilities.
- `npm ci --prefix client`: passed with zero reported vulnerabilities.
- `npm test`: 28 suites and 430 tests passed.
- `npm run build`: Vite production build passed.

## First feature track

Implement **Fleet Send**: stage one file, select many exact-model printers, preflight compatibility and duplicate filenames, resolve all conflicts in one summary, then run Upload only or guarded Upload & print with per-printer progress. The existing automatic scheduler remains independent.

The source design is `docs/sentry-fleet-send-design.md`. Start with test-only driver capability extraction and a server-side session service; do not issue real printer commands during automated verification. Real hardware proof comes later through the local dashboard using an operator-selected known-safe file.

### Implemented on `codex/sentry-fleet-dispatch`

- `522de40` — committed Fleet Send design and phased contribution plan.
- `604fb72` — added non-breaking optional CC1 list/upload/start/delete capabilities; the existing scheduler still calls `uploadAndPrint`, which now composes the same upload and start functions.
- `911d147` — added immutable, expiring, one-shot many-printer sessions with exact-model/filament/idle checks, duplicate decisions, remote byte verification, per-target isolation, and no Project/Part accounting writes.
- `9668c2c` — mounted multipart preflight, public session, SSE progress, explicit execute, and cancel API routes.
- Added the React Fleet Send operator page at `client/src/pages/FleetSend.jsx` with its page-specific styling in `FleetSend.css`. It supports upload-only or upload-and-print, exact-model lanes, material checks, explicit target selection, one fleet conflict HUD, confirmation, and per-printer progress.
- Published the complete application at `http://100.125.73.7:8765/centauri-sentry-next/`. The dashboard route reverse-proxies the persistent loopback service at port 3010; it is not the old isolated static demo.
- Persistent deployment: `/Users/leebob/.local/share/print-farm-manager-sentry-next/app`. LaunchAgent: `studio.lbcreations.centauri-sentry-next`. Named wrapper: `/Users/leebob/Applications/LB Background Services/Centauri Sentry Next Service.app`.
- Imported eight active CC1 records and preserved the broken CC2 as a decommissioned record with its camera-repair note. All active printers are held, so polling is live but no automatic or Fleet Send dispatch is eligible until operator release.

Current verification: official parallel `npm test` passes 30 suites / 452 tests; the upstream-standard parallel suite is green. The mounted production build passes. Dashboard desktop and touch-mobile interaction proof reports no horizontal overflow, console errors, page errors, or failed requests. It verifies the complete navigation, all eight active CC1 names, the Fleet Send page, and the decommissioned CC2 record. Live polling connected to the CC1 fleet; no file was uploaded and no print command was sent.

Next action: Lee reviews live statuses and releases only printers that are physically ready. Then conduct an operator-chosen CC1 Upload only proof before any Upload & print proof. Add CC2 Fleet Send only after confirming a primary source for remote file listing and deletion; do not mix CC1 and CC2 targets.

## Later tracks

1. Extend decommissioned printers into a Clinic with repair stages, parts, notes, and history.
2. Add MAC/mainboard identity and safe IP recovery.
3. Add optional OctoEverywhere name, connector lifecycle, and camera-link integration.
4. Add maintenance/reboot/version surfaces only where the underlying printer protocol safely supports them.

## Board task

`task-agent-checkin-2026-07-18-codex-print-farm-manager-establish-sentry-next-upstream-fork-and-contribution-roadmap`
