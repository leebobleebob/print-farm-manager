# Fleet Send Design

Date: 2026-07-18

## Outcome

Fleet Send gives an operator a direct, explicit path to upload one sliced file to many selected compatible printers. It is intentionally separate from the automatic Project/Part scheduler.

The operator can choose:

- **Upload only** — transfer and verify the current file without starting a print.
- **Upload & print** — transfer and verify the current file, then start only the selected printers that still pass every fresh safety check.

## Operator flow

1. Open Fleet Send and choose a new local file or a recent server-side file.
2. The server identifies the intended printer model from the explicit selection and available file metadata. Unverified metadata is shown as a warning; an explicit exact model remains required.
3. Select printers from only that exact-model lane.
4. Optionally declare the file's material and color. A selected printer whose recorded filament does not match is blocked with a friendly correction prompt until its loaded-filament record is updated.
5. Choose Upload only or Upload & print.
6. Preflight creates a short-lived one-shot session, lists remote files, and classifies every target as ready, duplicate-same-size, duplicate-different-size, busy, held, inactive, incompatible, offline, identity-conflict, or failed.
7. One fleet conflict HUD shows every duplicate. The operator chooses Replace or Skip per printer, then confirms once.
8. The dashboard shows per-printer byte and percent progress through replacing, uploading, verifying, starting, uploaded, printing, skipped, busy, or failed.
9. Upload & print starts only a file verified in this same session, after a fresh status and identity check. A consumed or expired session cannot start again.

## Safety invariants

- A Fleet Send session has one immutable staged file, filename, byte size, digest, exact model, action, creation time, expiry time, and target set.
- Centauri Carbon, Centauri Carbon 2, Bambu, and other model outputs are not interchangeable merely because their extensions match.
- The server re-reads the target printer from SQLite immediately before upload and again before print start.
- Inactive/decommissioned, held, busy, offline, model-mismatched, filament-mismatched, or identity-mismatched printers never start.
- Duplicate replacement deletes only the exact selected filename on the exact selected printer after confirmation.
- A successful transport is not enough. The driver must list the same remote filename and size before that target becomes start-eligible.
- Print eligibility is scoped to this session's verified target/file pair. No older upload or same-named remote file inherits eligibility.
- Execution is one-shot. Retries happen inside a target operation and cannot consume the session twice.
- Automated tests mock all network calls and never heat, move, or start physical hardware.
- Ad-hoc sends do not credit `completed_qty`, create production jobs, or trigger the automatic scheduler.

## Architecture

### Optional driver capabilities

The existing required driver contract remains compatible. Fleet Send introduces optional capabilities:

```js
uploadFile(printer, localPath, remoteName, options)
startFile(printer, remoteName, options)
listFiles(printer)
deleteFile(printer, remoteName)
acceptedExtensions
```

`options.onProgress(bytesSent, totalBytes)` reports upload progress where the protocol exposes it. Drivers without the full capability set are labeled unsupported in Fleet Send; their existing scheduler behavior remains unchanged.

For drivers that support Fleet Send, `uploadAndPrint` is refactored to call `uploadFile` followed by `startFile`. This preserves upstream scheduler behavior while eliminating divergent protocol implementations.

### Session service

`server/fleet-send.js` owns short-lived in-memory sessions and staged files under a dedicated runtime directory. It performs preflight, validates decisions, limits concurrency, emits progress events, verifies remote size, and enforces one-shot execution.

The first API surface is:

- `POST /api/fleet-send/preflight` — multipart file plus exact model, action, selected printer IDs, optional material/color.
- `GET /api/fleet-send/:id` — current session state.
- `GET /api/fleet-send/:id/events` — server-sent progress events.
- `POST /api/fleet-send/:id/execute` — Replace/Skip decisions and one explicit confirmation.
- `DELETE /api/fleet-send/:id` — cancel and remove staged data.

### UI

Add a Fleet Send page using the existing React visual language. Keep model lanes separate. The duplicate/conflict surface is one in-page HUD, not a sequence of blocking browser dialogs. The page remains usable during uploads and shows each target's progress independently.

## First supported hardware

The first real-hardware slice targets Elegoo Centauri Carbon and Centauri Carbon 2 because both protocols already exist upstream and the local farm can prove them. Other brands retain scheduler support and can opt into Fleet Send as their list/upload/start/delete capabilities are implemented and tested.

CC1 already exposes file listing and deletion through SDCP. Its existing upload and safe start payload can be split without changing the protocol.

CC2's existing chunked upload and MQTT start steps can be split immediately. Remote file listing/deletion must be implemented from a confirmed protocol source before duplicate replacement or upload verification is enabled; unsupported guesses are not acceptable.

## Accounting and recent files

The first slice stages a newly selected file and does not alter Project/Part accounting. A later file-library slice may expose recent project G-code and retained ad-hoc files, but choosing one must still create a new one-shot Fleet Send session and repeat every target preflight.

## Contribution boundary

Keep commits narrow:

1. Optional driver capability contract and tests.
2. Fleet Send session service and API with mocked drivers.
3. CC1 implementation and mock-network tests.
4. CC2 implementation after file-list/delete protocol confirmation.
5. React Fleet Send UI and browser proof.

After local automated and real-fleet proof, open an upstream issue describing the general workflow without private fleet names, IP addresses, credentials, or OctoEverywhere account data. Offer focused pull requests rather than one large local-customization dump.

