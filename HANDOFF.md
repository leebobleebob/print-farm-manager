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

Current verification: official parallel `npm test` passes 30 suites / 452 tests; the two suites that flaked only when all tests were forced serial both pass alone, and the upstream-standard parallel suite is green. `npm run build` passes. All printer protocols remain mocked; no live hardware command was sent.

Next action: build the React Fleet Send page against these APIs, verify the conflict HUD and per-printer progress with mocked/demo state, then add the CC2 file-list/delete protocol only after confirming a primary/proven source.

## Later tracks

1. Extend decommissioned printers into a Clinic with repair stages, parts, notes, and history.
2. Add MAC/mainboard identity and safe IP recovery.
3. Add optional OctoEverywhere name, connector lifecycle, and camera-link integration.
4. Add maintenance/reboot/version surfaces only where the underlying printer protocol safely supports them.

## Board task

`task-agent-checkin-2026-07-18-codex-print-farm-manager-establish-sentry-next-upstream-fork-and-contribution-roadmap`
