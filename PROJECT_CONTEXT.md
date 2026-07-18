# Local Fork Context

## Purpose

This fork evaluates `joeltelling/print-farm-manager` as the long-term local fleet server and contribution base. The original project remains the upstream authority. Local additions should be separable, tested, documented, and suitable for an upstream issue or pull request after real-hardware proof.

## Operating decisions

- Keep the server LAN-only. Do not expose printer credentials or the application directly to the public internet.
- Preserve upstream's automated Project/Part scheduler and sacred part-count rules.
- Add a separate operator-driven **Fleet Send** workflow for one file to many explicitly selected compatible printers.
- Fleet Send must support both **Upload only** and **Upload & print**.
- A print start is one-shot and belongs only to the current staged file/session. It requires a verified upload plus a fresh active/idle/model/material/identity check.
- Exact printer model is the compatibility boundary. Centauri Carbon and Centauri Carbon 2 files are never mixed.
- Duplicate filenames are resolved in one fleet summary with per-printer Replace/Skip decisions before network mutation.
- Ad-hoc Fleet Send operations do not modify Project/Part completion counts. Optional project association can be designed later.
- OctoEverywhere is an optional server-side integration for canonical display names, connector lifecycle, and authenticated camera links. It is not a replacement for local printer protocols.
- Extend upstream decommissioning into a repair-oriented Clinic without losing identity, notes, parts, or history.

## Upstream hygiene

- `origin` is Lee's fork: `leebobleebob/print-farm-manager`.
- `upstream` is `joeltelling/print-farm-manager`; its push URL is disabled locally.
- Local development branch: `codex/sentry-fleet-dispatch`.
- Large features should be offered upstream only after local tests and real fleet proof, with private names, addresses, and credentials removed from public artifacts.

## Baseline proof

On 2026-07-18, upstream `main` passed 28 Jest suites / 430 tests and the Vite production build under Node 22.23.1. After the initial Fleet Send driver, service, and API slices, the fork passes 30 suites / 452 tests and the production build. The canonical shared-root path contains spaces, which breaks the native `better-sqlite3` source build; dependency installation and tests therefore run from a temporary space-free clone while the canonical repository remains here.
