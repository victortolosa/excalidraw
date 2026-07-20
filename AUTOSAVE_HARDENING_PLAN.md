# Autosave hardening plan

## Purpose

Harden the self-hosted server-file autosave path against tab switching, tab closure, browser discard, network failure, concurrent tabs, authentication expiry, and large drawings.

This plan applies primarily to `excalidraw-app/data/serverStorage.ts` and the file API in `server/`. Scratch-mode browser persistence is handled separately in Phase 4 because it is upstream-owned code and expands the fork surface.

## Goals

- Never silently lose a dirty server-file revision.
- Always have either a confirmed server copy or a confirmed local recovery copy.
- Never silently overwrite changes from another tab, device, or direct filesystem edit.
- Make save status describe actual durability.
- Keep every phase independently testable, deployable, and reversible.
- Keep custom logic in additive fork files wherever possible.

## Non-goals

- Real-time collaborative editing.
- Automatic merging of conflicting drawings.
- Changing Excalidraw's file format.
- Upstreaming the homelab-specific persistence layer.

## Current failure modes

- `flushServerSave()` can return while a save is active, leaving a newer revision behind a background timer.
- Recovery is written only after a request reports failure, not before network I/O.
- Full-scene recovery uses `localStorage`, which is too small for image-heavy drawings.
- A queued save can retain an obsolete mtime baseline and conflict with its own earlier save.
- The page-exit fallback performs an unconditional PUT and can overwrite newer work.
- Concurrent server PUTs are not serialized.
- Temporary server filenames can collide when writes begin in the same millisecond.
- Module-level lifecycle listeners accumulate in tests and potentially during hot reload.
- Scratch mode ignores save requests while `document.hidden` is true.

## Delivery rules

- Work only on `custom` and push only to `origin`.
- Never push to or open a pull request against `upstream`.
- Do not sync upstream during a phase.
- Begin each behavior change with a failing regression test.
- Keep commits small and single-purpose.
- Run `yarn test:update` before every commit.
- Deploy each completed phase independently using the normal immutable-image workflow.
- Roll back by image SHA if a phase regresses behavior.

### Cross-cutting prerequisites

- The save-status taxonomy in Phase 4 (memory / local / server durability) is the target model. Every earlier phase must emit states that map forward into it — do not invent throwaway status strings that Phase 4 has to unwind.
- Phases 2–4 depend on `IndexedDB`, `BroadcastChannel`, the Web Locks API, `navigator.storage`, and `document.wasDiscarded`, none of which exist in jsdom. Add the test doubles (`fake-indexeddb` and shims for the rest) as the first commit of each phase that needs them, before writing the failing regression test — otherwise the test-first rule is blocked.
- Do not let the durability guarantees rest on deniable APIs. `navigator.storage.persist()` can be refused and `beforeunload` is unreliable and cannot save asynchronously. The load-bearing durability path is the `visibilitychange → hidden` local write plus server acknowledgment; persist and beforeunload are belt-and-suspenders only.

## Phase 1: Stop tab-switch and concurrent-save races

### Outcome

Tab switching cannot strand a revision, and concurrent writes cannot collide or bypass conflict detection.

This is the first phase to implement because it offers the largest immediate risk reduction without changing the storage format or touching additional upstream files.

> **Implemented** (not yet committed/deployed). `serverStorage.ts` now runs a single shared drain loop; `server/src/app.ts` guards writes with a per-path mutex and a content ETag. Suites green: server 29, app 27, typecheck clean. Remaining before deploy: `yarn test:update` + `yarn build:app:docker` + the deploy checklist below.

### Client work

- [x] Replace the `saveInFlight` boolean flow with one shared save-loop promise. (`runDrain` + `drain()`)
- [x] Add monotonically increasing client revision numbers. (`nextRevision` / `PendingSave.revision`)
- [x] Retain the newest pending snapshot while an older request is active.
- [x] Make `flushServerSave()` await the active request and continue until the queue is clean.
- [x] Resolve the current conflict baseline when a request is sent, not when it is queued.
- [x] Update the baseline before sending the next queued revision.
- [x] Clear pending state only when the acknowledged revision matches it.
- [x] Drain immediately on `visibilitychange` when hidden.
- [x] Retry draining on focus, `pageshow`, and route changes.
- [x] Replace the unconditional page-exit PUT with a **guarded** exit PUT (sends the current validator, honors the conflict guard) rather than removing it outright. It stays until Phase 2's durable local write supersedes it — removing it now would open a close-during-debounce gap with no local fallback yet in place.
- [x] Never mark the scene saved until the server acknowledges the revision.

### Server work

- [x] Generate temporary filenames with `randomUUID()`.
- [x] Add a per-path mutex around conflict validation and atomic replacement. (`withPathLock`)
- [x] Adopt a strong content validator from the start: compute a content hash (ETag) for each file and use it as the conflict baseline, returned on read and on successful write. Prefer this over mtime — filesystem mtime resolution is coarse (often 1 s), so two writes in the same second are indistinguishable, giving a false-negative conflict window. The full precondition protocol (`If-Match` / `If-None-Match`) lands in Phase 3; Phase 1 only needs the validator to be content-derived so no baseline work is thrown away.
- [x] Return a conflict response for a stale writer (validator mismatch inside the mutex).
- [x] Retain mtime for dashboard sorting/display only.
- [x] Ensure temporary files are cleaned up after failed writes.

### Tests

- [x] Delay the first client PUT, queue a second edit, then hide the tab. (covered by "flush awaits the in-flight save and drains a newer edit after it" — flush is the same drain path `visibilitychange` invokes)
- [x] Verify the latest revision reaches the server before `flushServerSave()` resolves.
- [x] Verify repeated flush calls share the same drain operation.
- [~] Verify a route change drains the outgoing file before loading another file. (`loadServerScene` awaits `flushServerSave()` first; no dedicated test yet)
- [x] Issue simultaneous same-file PUTs.
- [x] Require one accepted write, one conflict, and zero server errors.
- [x] Verify different files can still save concurrently.

### Acceptance criteria

- [x] No revision depends solely on a background timer after the tab becomes hidden.
- [x] An edit arriving during an active request is saved automatically afterward.
- [x] The reproduced same-file concurrent-write server error is eliminated.
- [x] No lifecycle request can bypass the conflict guard.
- [x] Existing dashboard, thumbnail, recovery, and server tests remain green.

### Expected files

- `excalidraw-app/data/serverStorage.ts`
- `excalidraw-app/tests/serverStorage.test.tsx`
- `server/src/app.ts`
- `server/src/app.test.ts`

## Phase 2: Add durable write-ahead recovery

### Outcome

Every dirty revision is stored locally before network saving. A crash, discard, offline period, or server failure cannot silently destroy it.

### Recovery record

Store one latest recovery record per normalized drawing path in IndexedDB:

```text
path
serializedScene
clientRevision
baseValidator
updatedAt
saveState
```

### Work

- [ ] Add an IndexedDB recovery adapter in a new fork-owned module.
- [ ] Persist the newest scene before starting its network request.
- [ ] Journal changes while visible on a short local debounce of approximately 250-300 ms, but only when the scene actually changed (skip-if-unchanged, same guard as the network save) so idle selection/viewport `onChange` events do not trigger writes.
- [ ] Keep journal writes off the interactive path for large scenes: `serializeAsJSON` is synchronous and re-serializing an 8-10 MiB scene every debounce tick on the main thread will cause input lag during active drawing — the exact case this plan targets. Serialize/write off the main thread (worker) or otherwise ensure the write does not block input; measure before shipping.
- [ ] Force the current journal write to begin and commit when the document becomes hidden.
- [ ] Keep the recovery record until the exact revision is acknowledged by the server.
- [ ] Prevent an older successful request from clearing a newer recovery record.
- [ ] Restore recovery after reload, crash, discard, auth expiry, or server outage.
- [ ] Migrate existing `excalidraw-server-recovery:*` records from `localStorage`, then remove the old `localStorage` recovery writes entirely so a revision is never journaled to both stores.
- [ ] Request persistent browser storage with `navigator.storage.persist()`.
- [ ] Report IndexedDB and quota failures to the save-status UI.
- [ ] Stop claiming that work is kept locally unless the recovery write succeeded.

### Tests

- [ ] Close or reload during a delayed PUT and restore the latest revision.
- [ ] Restore after a simulated discarded tab.
- [ ] Recover an image-heavy drawing larger than the `localStorage` quota.
- [ ] Verify an older server acknowledgment cannot delete a newer journal record.
- [ ] Verify recovery-write failure produces an unsafe status.
- [ ] Verify a successful retry clears only the acknowledged revision.
- [ ] Verify old `localStorage` recovery records migrate successfully.

### Acceptance criteria

- [ ] Every dirty scene has either a server acknowledgment or a confirmed IndexedDB recovery record.
- [ ] Recovery works for drawings of at least 8-10 MiB.
- [ ] Journaling causes no perceptible input lag while drawing on an 8-10 MiB scene.
- [ ] Reloading after a failed or interrupted save offers the latest local revision.
- [ ] Recovery state is retained until server durability is confirmed.

### Expected files

- `excalidraw-app/data/serverRecovery.ts` or equivalent new module
- `excalidraw-app/data/serverStorage.ts`
- `excalidraw-app/components/ServerSaveStatus.tsx`
- Focused recovery and storage tests

## Phase 3: Use strong validators and coordinate tabs

### Outcome

Stale tabs, other devices, and direct filesystem changes cannot silently overwrite one another.

### Server protocol

Phase 1 already computes and returns a content ETag and uses it as the conflict baseline. Phase 3 promotes that ad-hoc check to the standard HTTP precondition protocol.

- [ ] Return the ETag on GET and successful PUT responses (already added in Phase 1 — confirm the format is a strong validator).
- [ ] Require `If-Match` when updating an existing drawing.
- [ ] Require `If-None-Match: *` when creating a drawing.
- [ ] Evaluate the precondition inside the per-path mutex.
- [ ] Return `412 Precondition Failed` for stale clients.
- [ ] Retain mtime only for dashboard sorting and display.
- [ ] Keep both the server copy and the local recovery copy after a conflict.

### Browser coordination

- [ ] Use a path-scoped Web Lock around the **local** save critical section only — do not hold it across the network PUT, or a hung request will stall every other tab's save for that path indefinitely. Use `ifAvailable`/a timeout and let the server per-path mutex be the real serialization point for the write itself.
- [ ] Broadcast successful revisions and ETags through `BroadcastChannel`.
- [ ] Warn a stale tab before its next save.
- [ ] Keep the server ETag authoritative for other devices.
- [ ] Offer reload, explicit overwrite, and recovery export actions on conflict.
- [ ] Do not automatically merge conflicting drawings.

### Tests

- [ ] Interleave edits from two browser contexts.
- [ ] Verify there is no silent last-writer-wins behavior.
- [ ] Change a file directly on disk and reject the stale browser PUT.
- [ ] Race two new-file creations.
- [ ] Verify different drawing paths remain independent.
- [ ] Verify a conflict preserves the local recovery record.

### Acceptance criteria

- [ ] Every stale update is rejected or explicitly confirmed by the user.
- [ ] Two tabs cannot silently overwrite each other.
- [ ] Both versions remain recoverable after a conflict.
- [ ] Existing dashboard mtime sorting and thumbnail invalidation still work.

### References

- [MDN: If-Match](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/If-Match)
- [MDN: Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)

## Phase 4: Lifecycle, UX, and scratch-mode hardening

### Outcome

Remaining lifecycle paths are deterministic, save status is truthful, and scratch mode no longer drops hidden-tab changes.

### Lifecycle work

- [ ] Move module-level listeners behind an install/dispose API.
- [ ] Prevent duplicate listeners during tests and hot reload.
- [ ] Pause network retries while offline or authentication is expired.
- [ ] Resume on `online`, focus, `pageshow`, and successful reauthentication.
- [ ] Add exponential retry backoff with jitter.
- [ ] Register `beforeunload` only while work lacks confirmed durability.
- [ ] Check `document.wasDiscarded` on load and prioritize recovery restoration.

### Save-status states

```text
Unsaved in memory
Saved locally
Saving to server
Saved to server at <time>
Offline - safe locally
Session expired - safe locally
Local recovery failed
Conflict - both versions preserved
```

### UX work

- [ ] Add a `Retry now` action.
- [ ] Add an `Export recovery copy` action.
- [ ] Add a manual `Save now` action after the Phase 1 drain operation is trustworthy.
- [ ] Bind Cmd/Ctrl+S to acknowledged server save while a server file is open.
- [ ] Keep Cmd/Ctrl+Shift+S for downloading a local `.excalidraw` backup.
- [ ] Display success only after the requested revision is acknowledged.

### Scratch-mode work

- [ ] Retain changes emitted while `document.hidden` is true instead of dropping them.
- [ ] Save on the hidden transition.
- [ ] Prevent tab synchronization from overwriting locally dirty state.
- [ ] Keep the upstream-file patch minimal.
- [ ] Update the fork surface manifest if `LocalData.ts` is modified.

### Browser reliability tests

- [ ] Active text editing during tab switching.
- [ ] Tab close during a delayed request.
- [ ] Browser freeze and discard.
- [ ] Server termination and restart.
- [ ] Authentication-wall response.
- [ ] Offline and online transitions.
- [ ] Large embedded files.
- [ ] Two tabs editing the same path.
- [ ] Hot reload without duplicate lifecycle listeners.

### Acceptance criteria

- [ ] Status always distinguishes memory, local, and server durability.
- [ ] Lifecycle listeners are installed exactly once and cleaned up.
- [ ] Scratch and server modes both survive tab switching.
- [ ] Retry behavior does not create a tight loop during prolonged outages.
- [ ] The Docker smoke test passes with a mounted data directory.

### References

- [Chrome: Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- [MDN: visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)
- [Fetch Standard: keepalive limit](https://fetch.spec.whatwg.org/)
- [MDN: Browser storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

## Interim manual-backup guidance

Until Phase 1 is complete, a server `Save now` button that only calls the current `flushServerSave()` would provide false confidence because it can return while a save remains queued.

For important work:

- Use Cmd/Ctrl+Shift+S or the existing file export flow to download a local `.excalidraw` backup.
- Wait for the current server status to show `Saved` before switching or closing tabs, while recognizing that the current status does not protect against every race listed above.
- Avoid editing the same drawing in multiple tabs.
- Keep the mounted server data directory covered by the existing external backup process.

Add the acknowledged server `Save now` button during Phase 4, after Phase 1 makes the underlying drain operation reliable. If desired, a separate `Download backup` button can be added earlier because it bypasses server autosave entirely.

## Verification commands

Run the focused checks while iterating:

```bash
yarn test:app excalidraw-app/tests/serverStorage.test.tsx --watch=false
npm test --prefix server
yarn test:typecheck
```

Before committing any phase:

```bash
yarn test:update
yarn build:app:docker
```

Before deploying:

- [ ] Confirm the worktree contains only intended changes.
- [ ] Review the upstream fork surface.
- [ ] Complete a local Docker smoke test.
- [ ] Commit the completed phase on `custom`.
- [ ] Push only to `origin custom`.
- [ ] Confirm the GitHub Actions image build succeeds.
- [ ] Deploy the new image on `docker-i5`.
- [ ] Verify `/api/health` and the edit-save-reload loop.
- [ ] Record the deployed commit SHA for rollback.

## Overall definition of done

- [ ] Tab switching while actively editing does not lose the latest revision.
- [ ] Closing or discarding a dirty tab restores the latest local revision.
- [ ] Offline and authentication failures retain recoverable work.
- [ ] Large drawings have durable recovery.
- [ ] Same-file concurrent writers cannot silently overwrite one another.
- [ ] Save status accurately reports memory, local, and server durability.
- [ ] All focused, full app, typecheck, server, and Docker tests pass.
