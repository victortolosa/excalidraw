# Excalidraw Dashboard — Step-by-step checklist

Commit-sized steps for building the self-hosted drawing dashboard yourself.
Companion to [DASHBOARD_PLAN.md](DASHBOARD_PLAN.md) — the plan has the *why* and the
architecture decisions; this file is the *do*, broken into one-sitting units.

## How to use this file

- **One step = one small commit on `custom`.** Don't push until the step's *Done when*
  passes — pushing triggers the GHCR image build.
- **Only sync upstream at phase boundaries**, never mid-phase (see the upstream sync
  runbook in DASHBOARD_PLAN.md).
- Check the box when a step's *Done when* is green. Record any decision changes back in
  DASHBOARD_PLAN.md's Decisions section with a date.

---

## Phase 0 — Repo prep

- [x] **0.1 Sync upstream (optional).** `git fetch upstream && git merge upstream/master`
  into `custom`, resolve conflicts, run `yarn test:typecheck`.
  *Done when:* typecheck passes, tree clean.
- [x] **0.2 Add the GHCR compose file.** New root file `docker-compose.ghcr.yml` (kept
  distinct from the existing dev `docker-compose.yml`): `image:
  ghcr.io/victortolosa/excalidraw:latest`, volume `./data:/data`, ports `8085:80`.
  *Done when:* file exists, **no `build:` key**.
- [x] **0.3 Push, confirm green.** `git push origin custom`, watch the `build-and-push`
  action.
  *Done when:* GHCR shows a fresh `:latest` + `:<sha>`.

**Phase verify:** fresh upstream merged, compose file exists, CI green.

---

## Phase 1 — Backend file API + Docker

Build `server/` as a standalone Node/Hono app first — `curl` it without touching
Excalidraw at all.

- [x] **1.1 Scaffold.** `server/` with Hono: serve `excalidraw-app/build` statically +
  `GET /api/health`. Data dir from `DATA_DIR` env (default `./data`).
  *Done when:* `node server` → `curl localhost:PORT/api/health` returns ok.
- [x] **1.2 Path sanitizer + its tests (do this first — it's the security boundary).**
  A `safePath(input)` util: reject `..`, absolute paths, and non-`.excalidraw`
  extensions; resolve strictly under `DATA_DIR`. Unit-test the traversal cases.
  *Done when:* tests prove `../../etc/passwd` and `foo.txt` are rejected, and
  `sub/a.excalidraw` is allowed.
- [x] **1.3 List.** `GET /api/files` → `[{path, name, mtime, size, folder}]`.
  *Done when:* dropping a `.excalidraw` into `./data` shows up in the response.
- [x] **1.4 Read/write/delete one file.** `GET/PUT/DELETE /api/files/*` (wildcard route
  so nested folders work), all through `safePath`. **PUT returns the new `mtime`** in the
  body (needed for the Phase 5 conflict guard).
  *Done when:* `curl PUT` creates the file on disk; GET reads it back; DELETE removes it.
- [x] **1.5 Rename/move + folders.** `POST /api/files/*/rename`,
  `POST/DELETE /api/folders/*`.
  *Done when:* rename moves the file on disk; creating a folder makes a real dir.
- [x] **1.6 Metadata.** `GET/PUT /api/meta` backed by `.dashboard.json` in the data dir.
  *Done when:* PUT then GET round-trips a favorites/order blob.
- [x] **1.7 Thumbnail endpoints.** `PUT/GET /api/files/*/thumbnail` → stored under
  `.thumbnails/` keyed by path + mtime.
  *Done when:* PUT an SVG, GET it back.
- [x] **1.8 `Cache-Control: no-store` on all `/api`.** One middleware line.
  *Done when:* `curl -I` an API response shows the header.
- [x] **1.9 Vite dev proxy.** In `excalidraw-app/vite.config.mts`: `/api` →
  `http://localhost:PORT`. Keep it tiny; add to the fork-surface manifest.
  *Done when:* `yarn start` + `node server` → a browser fetch to `/api/health` works
  through Vite.
- [x] **1.10 Dockerfile runtime stage.** Replace the nginx final stage with
  `node:24-alpine` running `server/`. Leave the build stage untouched.
  *Done when:* `docker build` + run with `-v ./data:/data` → app loads **and**
  `curl /api/files` works in the container.

**Phase verify:** `curl PUT` creates a `.excalidraw` file in the mounted dir; app still
loads in the browser.

---

## Phase 2 — Editor open/save wiring ⚠️ riskiest (touches upstream)

Keep every upstream diff minimal. The only upstream file that gains logic here is
`App.tsx`; everything else is the additive `serverStorage.ts`.

- [x] **2.1 Parse `#/d/<path>`.** Follow the existing `#json=` pattern in `App.tsx`
  (~line 226). Just detect the mode and extract the path for now.
  *Done when:* loading `#/d/test.excalidraw` logs the parsed path.
- [x] **2.2 `serverStorage.ts` load (additive file).** `loadFromServer(path)` → GET the
  file, return `{elements, appState, files}`, and **remember the returned `mtime`** as
  the conflict baseline.
  *Done when:* opening a server URL renders the on-disk drawing.
- [x] **2.3 `serverStorage.ts` save (additive file).** Own debounce (~3–5s), and **skip
  the PUT if the serialized scene is unchanged** since last save. On a successful PUT,
  refresh the stored `mtime` baseline from the response.
  *Done when:* repeated no-op changes send zero PUTs; a real edit sends exactly one.
- [x] **2.4 Branch inside `onChange`.** At `App.tsx` ~line 689: if a server file is open,
  call `serverStorage` save; else keep stock `LocalData.save`. This is the whole upstream
  save hook — keep it a few lines. **Do not edit `LocalData._save`.**
  *Done when:* editing a `#/d/` file writes to disk after the debounce; plain `#/` usage
  is byte-for-byte stock.
- [x] **2.5 Flush on lifecycle.** Reuse the existing `flushSave` spots (`App.tsx` ~line
  619) to also flush the server save on visibilitychange / tab close / route back to the
  dashboard.
  *Done when:* closing the tab mid-edit still persists the last change.
- [x] **2.6 Bypass localStorage restore + tabSync when a server file is open**
  (pre-flight #3 trap). Guard restore-on-load and `tabSync` so scratch content can't
  bleed into a server file.
  *Done when:* draw on `#/`, then open `#/d/a.excalidraw` → the server file is **not**
  polluted with scratch content; two tabs on two different files don't fight.
- [x] **2.7 Save-status indicator.** saved / saving / error in the UI.
  *Done when:* the indicator reflects a real PUT and an error (kill the server to test).

**Phase verify:** open `#/d/test.excalidraw`, draw, wait for debounce → file on disk
updates; reload restores; plain `#/`-less usage still works as stock.

---

## Phase 3 — Dashboard MVP

- [x] **3.1 Route shell.** `excalidraw-app/dashboard/` at `#/`, empty shell.
  *Done when:* `#/` shows the dashboard, `#/d/x` still shows the editor.
- [x] **3.2 Card grid.** List from `GET /api/files`.
  *Done when:* files render as cards.
- [x] **3.3 Thumbnails.** Generate SVG client-side after save → PUT; grid loads from the
  thumbnail endpoint, **not** full files.
  *Done when:* grid shows thumbnails without downloading every full drawing.
- [x] **3.4 Create new.** Name prompt → PUT empty scene → open editor.
  *Done when:* new file appears on disk and opens.
- [x] **3.5 Open / rename / delete-with-confirm.**
  *Done when:* all three work from the grid.
- [x] **3.6 Sort by name / modified.**
  *Done when:* toggle reorders.

**Phase verify:** full loop — create, draw, return to dashboard, see thumbnail, rename,
reopen, delete.

---

## Phase 4 — Organization

- [x] **4.1 Favorites.** Star toggle → persisted in `.dashboard.json`; favorites section.
  *Done when:* favorite/unfavorite survives a server restart.
- [x] **4.2 Folders.** Create / browse / move files (real directories in the data dir).
  *Done when:* moving a file relocates it on disk.
- [x] **4.3 Search.** Filename match + text-element content match.
  *Done when:* search finds a drawing by text inside it.
- [x] **4.4 Recents.** Last-opened, from metadata.
  *Done when:* recently opened files surface first.
- [x] **4.5 Cmd+K quick switcher.**
  *Done when:* Cmd+K opens files by name.

**Phase verify:** favorites persist across restart; search finds by inner text; Cmd+K
opens files.

---

## Phase 5 — Polish & hardening

- [x] **5.1 Conflict guard.** Client sends its baseline mtime; server 409s if disk mtime
  is newer; UI offers reload-or-overwrite. (Step 2.3 keeps the baseline fresh so you
  don't conflict with your own writes.)
  *Done when:* a two-tab edit triggers the conflict UI.
- [x] **5.2 Dark mode parity** for the dashboard.
- [x] **5.3 Backup script** for the data dir (cron rsync or model on the NoteDiscovery
  backup script). *Installed on docker-i5 2026-07-06: script at
  `/opt/homelab/docker/excalidraw/backup-data.sh`, daily cron 03:30 →
  `/opt/backups/excalidraw` (dir owned by victor); test run verified.*
- [x] **5.4 Offline fallback.** Server unreachable → editor falls back to localStorage
  with a banner.
  *Done when:* killing the server mid-edit doesn't lose work.
- [x] **5.5 Auth-expiry handling.** Non-JSON API response (Cloudflare Access login page)
  → detect it, show a "session expired" banner, keep unsaved work in localStorage until
  re-auth.
- [x] **5.6 Dashboard interaction polish.** Sleek workspace layout, route-scoped
  dashboard scrolling, tabbed Quick access (Favorites or Recent), compact card action
  menus, and hardened drag/drop moves into folders and breadcrumb targets.
  *Done when:* dashboard scrolls without breaking the editor canvas route; Quick access
  tabs switch cleanly; drag/drop moves files through the existing rename API and guards
  duplicate/self/stale drops.
- [ ] **5.7 Deploy + remote checklist.** Deploy to homelab and walk the "Remote access
  verification checklist" in DASHBOARD_PLAN.md.
  *Progress 2026-07-06: stack promoted to Git-managed template
  (`homelab:docker-services/excalidraw/`, deploy via `deploy.sh excalidraw`);
  backup script + cron installed and verified; **deployed — dashboard
  confirmed working at `https://draw.makeshit.app/#/`** (browsers cache the
  old shell via the PWA service worker; hard refresh after deploys).
  Remaining: Cloudflare Access settings review (empty path filter, exact
  emails, ~1-week session) and the remote verification checklist.*

**Phase verify:** two-tab edit triggers the conflict UI; killing the server mid-edit
doesn't lose work; remote checklist passes.

---

## Phase 6 — Sewing pattern tools

This fork doubles as a sewing-pattern editor. Every feature here is **gated behind the
pattern grid config** — nothing renders outside pattern-grid mode. State lives in
`appState` under the `patternGrid*` prefix (with matching `{ browser, export, server }`
persistence and a `types.ts` entry in both `AppState` and the `StaticCanvasAppState`
pick, threaded through `StaticCanvas.tsx`); rendering is in
`packages/excalidraw/renderer/staticScene.ts`; the control UI is
`packages/excalidraw/components/PatternGridWidget.tsx`. Follow the existing toggles when
adding a new one.

Already landed:

- [x] **6.1 Pattern grid overlay.** Real-world inch grid with pixels-per-inch scale,
  1/4"–1/10" subdivisions, snap, and inch labels.
- [x] **6.2 Configurable scale + zoom range.** Preset + custom px-per-inch (10–1000);
  `MIN_ZOOM` lowered to 0.02 so large patterns fit on screen.
- [x] **6.3 Measurements + per-edge lengths.** Element W/H/perimeter labels, plus a
  per-edge length label on each segment of line/polygon pieces
  (`patternGridEdgeLengthsEnabled`).

Next — **seam allowance visualization** (print-bleed analogy: the drawn shape is the
finished/stitch line, the offset outline is the cut line, the band between is the
allowance). Build in two commits; the geometry is the riskiest part we've added, so land
it first and eyeball it before wiring the calc.

- [ ] **6.4 Seam allowance — geometry + band (commit 1).** New config
  `patternGridSeamAllowanceEnabled` (bool, default off) + `patternGridSeamAllowanceInches`
  (number, default `0.5`; widget offers 3/8 · 1/2 · 5/8 preset chips + a custom input,
  disabled unless Measurements is on). Gated by
  `patternGridModeEnabled && patternGridMeasurementsEnabled && patternGridSeamAllowanceEnabled`.
  Convert the allowance to px via `patternGridPixelsPerInch`, then draw an outward offset
  of each shape:
  - **rect / ellipse:** exact grow (W+2a × H+2a / radii + a).
  - **closed line/polygon:** true contour offset — push each edge along its outward normal
    (winding from signed area) by `a`, reconnect corners with a **miter join, beveling past
    a miter limit** so acute corners don't spike. Build from `vectorNormal` / `vectorScale`
    / segment-intersection in `@excalidraw/math`.
  - **fallback:** if the offset self-intersects (shape too small for the allowance, or a
    nasty concave corner), draw the **bounding-box band** for that shape, styled as
    approximate. This bounds the blast radius.
  - **open polylines:** skip — no enclosed piece.
  - **draw:** translucent/hatched fill in the band (even-odd path between finished + cut
    rings) + a dashed cut-line outline, themed via `GridLineColor`.
  *Done when:* enabling the toggle draws a dashed cut line offset by the set allowance
  around a rectangle and a triangle; a shape shrunk below the allowance degrades to the
  bbox band instead of drawing garbage; nothing renders when pattern-grid mode is off.
- [ ] **6.5 Seam allowance — calc (commit 2).** Compute **finished** size (shape bbox W×H
  + area via shoelace) and **with-allowance** size (offset-ring bbox W×H + area). Surface
  both: on-canvas `Finished W×H` / `Cut W×H` label lines near each shape (reuse
  `drawMeasurementLabel`), **and** a selection summary line in the widget
  (e.g. `Finished 8×10" · Cut 9×11"`).
  *Done when:* selecting a piece shows finished vs. cut dimensions both on-canvas and in
  the widget, and the numbers track the allowance setting live.

Deferred (revisit after v1): per-edge allowances (hem ≠ seam), notches, inner offset.

**Phase verify:** toggling seam allowance on a rectangle and a triangle shows a correct
offset cut line and matching finished/cut sizes; a tiny shape falls back to the bbox band;
everything is off outside pattern-grid mode.
