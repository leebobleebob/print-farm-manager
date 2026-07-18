# Fleet Send Implementation Plan

Date: 2026-07-18

## Phase 1 — Capability contract

1. Add driver capability inspection without changing the existing required driver interface.
2. Write failing tests for a Fleet Send-capable mock driver and an unsupported legacy driver.
3. Split CC1 `uploadAndPrint` into tested `uploadFile` and `startFile` methods while preserving scheduler behavior.
4. Expose CC1 `listFiles` and exact-file `deleteFile` using SDCP.
5. Run the complete 430-test baseline plus new driver tests.

## Phase 2 — One-shot server sessions

1. Write failing unit tests for exact-model target validation, active/held/idle/material checks, immutable staged files, expiry, and single consumption.
2. Add duplicate classification and require Replace/Skip decisions for every conflict.
3. Add per-target upload progress, remote filename/size verification, fresh pre-start checks, and partial-fleet isolation.
4. Add API contract tests for preflight, event stream, execute, cancel, and redacted responses.
5. Prove that no Fleet Send path updates Projects, Parts, Jobs, or `completed_qty`.

## Phase 3 — Fleet Send UI

1. Add a Fleet Send route and navigation entry.
2. Build exact-model printer lanes, one file picker, Upload only / Upload & print choice, material/color check, and target selection.
3. Build the single conflict HUD with Replace selected, Skip existing, and Cancel.
4. Render independent progress rows and preserve the page during execution.
5. Run production build and desktop/mobile browser verification with mocked/demo data.

## Phase 4 — CC2 and real fleet proof

1. Confirm CC2 remote list/delete protocol from a primary or already-proven implementation.
2. Split the existing CC2 upload/start implementation and add mock-network tests.
3. Deploy the fork as a separate LAN-only test service without replacing the verified Centauri Sentry service.
4. Prove Upload only against one idle CC1 using an inert known-safe file; verify filename and byte size remotely.
5. Prove guarded Upload & print only when Lee selects a normal known-safe production file and target.
6. Expand to multiple same-model printers, then verify duplicate Replace/Skip and a deliberately blocked filament mismatch.

## Phase 5 — Community offering

1. Remove or isolate local-only documentation and configuration from the contribution branch.
2. Open the upstream design issue required by `CONTRIBUTING.md`.
3. Rebase focused commits onto current `upstream/main`.
4. Run the full Node 22 suite and production build from a space-free path.
5. Open small pull requests with protocol sources, mocked tests, screenshots for UI changes, and explicit real-hardware proof boundaries.

