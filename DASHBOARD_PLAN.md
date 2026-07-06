# Excalidraw Dashboard — Implementation Plan

A working document for building a self-hosted Excalidraw file dashboard on this fork.
Designed to be worked through phase-by-phase with an AI assistant — each phase is
self-contained, ordered, and ends with a verification step. Check off tasks as they land.

## Vision

Turn this Excalidraw fork into a **self-hosted drawing manager**, following the same
fork-and-patch workflow as `~/Repos/NoteDiscovery`:

- Drawings saved as plain `.excalidraw` files in a **volume-mounted local directory**
  (portable, human-readable, backup-friendly — like a notes vault).
- A **dashboard** in front of the editor: browse, search, favorite, and group drawings,
  with thumbnails and a Cmd+K quick switcher.
- Deployed via Docker: push to `custom` → GitHub Actions builds the image →
  `ghcr.io/victortolosa/excalidraw` → server runs `docker compose pull`.

## Current state (as of 2026-07-06)

Already done:

- Fork remotes configured: `origin` = victortolosa/excalidraw, `upstream` = excalidraw/excalidraw (push disabled).
- `custom` branch exists with `.github/workflows/build-custom.yml` — builds and pushes
  `ghcr.io/victortolosa/excalidraw:latest` + `:sha` on every push to `custom`.
- Dockerfile builds the app and serves it via **nginx (static only — no backend)**.

Not done yet: everything below.

## Key architectural fact

The stock app persists to browser `localStorage`/IndexedDB (`excalidraw-app/data/LocalData.ts`).
Saving to a server-side directory requires **adding a small backend** that owns the data
dir and exposes a file API. That is the core new piece; the dashboard and editor wiring
hang off it.

## Architecture

### Backend — new `server/` directory (additive, zero upstream conflicts)

Small Node service (Hono recommended; Express fine) that serves the built frontend
**and** the API from a single container:

| Endpoint | Purpose |
|---|---|
| `GET /api/files` | List `.excalidraw` files: path, name, mtime, size, folder |
| `GET /api/files/:path` | Read a drawing |
| `PUT /api/files/:path` | Write a drawing (see conflict guard, Phase 5) |
| `DELETE /api/files/:path` | Delete |
| `POST /api/files/:path/rename` | Rename/move |
| `POST /api/folders` / `DELETE /api/folders/:path` | Folder management |
| `GET /api/meta` / `PUT /api/meta` | Dashboard metadata |

- Data dir mounted at `/data`; path configurable via `DATA_DIR` env var.
- Metadata (favorites, custom order, last-opened) lives in one JSON file in the data
  dir: `.dashboard.json`. No database — the data dir stays plain files.
- Sanitize all paths (no `..` traversal); restrict to `.excalidraw` extension.

### Editor integration — the ONLY upstream files touched

- **Hash routing** in `excalidraw-app`: `#/` → dashboard, `#/d/<path>` → editor with that
  file. `App.tsx` already dispatches on `#json=` and `#url=` hashes — follow that pattern.
- New `excalidraw-app/data/serverStorage.ts`: fetch file on open; own debounced save
  that PUTs to the API when a server file is open. Wire it in by **branching inside the
  app-level `onChange` handler in `App.tsx`** (~line 689, where `LocalData.save` is
  already called) — **NOT** by editing `LocalData._save` in `LocalData.ts`. `onChange`
  already receives `(elements, appState, files)` and `App.tsx` is an already-tracked
  upstream file, so this keeps the patch additive and off `LocalData.ts` (which is not in
  the fork-surface manifest). localStorage remains the offline/scratch fallback for
  drawings not yet saved to the server.
- Save the **full scene including embedded images** (`.excalidraw` format supports inline
  `files` as data URLs) so every file on disk is self-contained.

### Dashboard — new `excalidraw-app/dashboard/` directory

- Card grid with client-side SVG thumbnails (`@excalidraw/utils` `exportToSvg`, cached by
  file mtime).
- Favorites (star), groups as **real folders** in the data dir (portable, not virtual),
  search (filename + text-element contents), recents, Cmd+K quick switcher.

### Decisions made (revisit only if they stop fitting)

- **Single Node container** serving static + API — not nginx + sidecar. One image tag,
  no proxy config. `build-custom.yml` needs no changes.
- **Real folders** for groups, not virtual groups in metadata — data dir stays portable.
- **JSON metadata file**, not SQLite — favorites/groups are tiny; keep it human-readable.
- **Leave collab/Firebase code untouched** — stripping it adds merge surface for no gain;
  it just sits unused.

## Patch-hygiene rules (the fork workflow)

1. **New files over edits.** `server/`, `excalidraw-app/dashboard/`, `serverStorage.ts`
   are all additive. Upstream files touched should be limited to: `App.tsx` (routing +
   the server-save branch inside the existing `onChange`, target <30 lines of diff — do
   **not** edit `LocalData.ts`), `index.tsx`, `vite.config.mts`, `Dockerfile`.
2. **Small, single-purpose commits on `custom`** — same style as the NoteDiscovery fork.
3. **Upstream sync:** `git fetch upstream && git merge upstream/master` into `custom`
   (merge, NOT rebase — `custom` is pushed and deployed). Sync **before** starting a new
   phase, never mid-feature.
4. Never push to `upstream` (push is disabled on the remote as a guard).

---

## Upstream sync runbook

Upstream (excalidraw/excalidraw) moves fast — often several commits a day. Don't chase
it; sync deliberately. The fork works fine without syncing, so a sync is always
*optional* and driven by wanting an upstream fix/feature or avoiding large drift.

### When to sync

- At **phase boundaries only** — never mid-feature (a half-built feature plus a merge is
  two problems at once).
- Roughly **monthly**, or when upstream ships something you specifically want.
- Before syncing, skim upstream changes for danger zones:
  `git log --oneline custom..upstream/master -- excalidraw-app/ Dockerfile package.json`

### Procedure

```bash
# 1. Preconditions: clean working tree, current phase committed
git fetch upstream
git checkout custom
git merge upstream/master        # merge, never rebase — custom is pushed & deployed
# 2. Resolve conflicts per the playbook below
# 3. Run the post-merge verification checklist
# 4. Push only after verification passes (push triggers the GHCR image build)
```

If the merge turns into a mess: `git merge --abort`, stay on the last good state, and
investigate the offending upstream refactor as its own task. Never resolve conflicts
you don't understand just to get the merge through.

### Conflict playbook

| File / area | Expected? | Strategy |
|---|---|---|
| `server/`, `excalidraw-app/dashboard/`, `serverStorage.ts` | Never (ours only) | No action |
| `excalidraw-app/App.tsx` | Occasionally | Re-apply the *intent* of our patch (routing + the server-save branch inside `onChange`) onto upstream's new code — don't blindly keep "ours". Our diff is deliberately <30 lines to make this easy |
| `Dockerfile` | Rare (~2×/year upstream) | Take upstream's **build stage** changes (node version bumps etc.), keep our **runtime stage** (Node server instead of nginx) |
| `package.json` / `yarn.lock` (root) | If we added workspace deps | Take upstream's version, re-add our deps, re-run `yarn` to regenerate the lockfile |
| `.github/workflows/` | Rare | Upstream workflows: take theirs. `build-custom.yml` is ours only |
| Anything else | Shouldn't happen | If a third upstream file has our changes in it, that's scope creep — note it in the manifest below and consider refactoring the patch to be additive |

### Post-merge verification checklist

The dangerous failures are **silent** — a merge that succeeds textually but breaks our
hook points semantically. Check in this order (cheap → expensive):

- [ ] `yarn test:typecheck` — catches renamed/removed APIs we depend on
- [ ] Grep that our integration points still exist and look the same:
  - the app-level `onChange` save hook (the `LocalData.save` call, ~line 689) in `excalidraw-app/App.tsx` — our server-save branch sits here
  - hash-route dispatch (`#json=`, `#url=`, our `#/d/`) in `excalidraw-app/App.tsx`
  - `exportToSvg` signature in `@excalidraw/utils` (thumbnails)
  - `.excalidraw` format `version` field — if bumped, test loading an old file
- [ ] `yarn test:update`
- [ ] Docker smoke test: `docker build` locally, run with a mounted dir, then the full
  loop — dashboard loads → open drawing → edit → autosave hits disk → reload restores
- [ ] Only now: `git push` (kicks off the GHCR build)

### Deploy safety & rollback

`build-custom.yml` tags every image with both `:latest` and `:<sha>` — that's the
rollback mechanism.

- **Safer default:** pin the homelab compose file to a specific `:<sha>` tag and bump it
  manually after a sync is verified, instead of tracking `:latest`. `latest` means every
  push deploys on the next `docker compose pull`, including unverified merges.
- **Rollback:** repoint compose at the previous known-good `:<sha>` and
  `docker compose pull && docker compose up -d`. Keep a note of the last known-good sha
  in the homelab repo's compose file as a comment.
- Data is safe regardless: drawings are plain files in the mounted volume, untouched by
  image rollbacks.

### Fork surface manifest

Every upstream file we modify, and why. **Keep this current** — during a conflict, this
table is what tells you the intent to re-apply. Additive files/dirs don't belong here.

| Upstream file | Why we touch it | Patch size target |
|---|---|---|
| `Dockerfile` | Runtime stage: Node server instead of nginx | Runtime stage only |
| `excalidraw-app/App.tsx` | `#/d/<path>` routing + server-save branch inside the existing `onChange` (~line 689); does **not** touch `LocalData.ts` | <30 lines |
| `excalidraw-app/index.tsx` | Mount dashboard route | <10 lines |
| `excalidraw-app/vite.config.mts` | Dev proxy `/api` → local server | <10 lines |

(Update as phases land. If this table grows past ~5 rows, patches are getting too
invasive — refactor toward additive files.)

---

## Pre-flight considerations (read before Phase 1)

Decisions and traps to handle early — each is cheap now and expensive later.

### 1. Auth: the file API has none — decide the exposure model

The API can read/write/delete everything in the data dir. Decision: **no app-level
auth; rely on network-level access control**. This already exists: `draw.makeshit.app`
is behind Cloudflare Access (Google SSO) via the `homelab-i5` tunnel — see the
"Remote access" section below for what must change when the backend lands. LAN access
(`10.0.0.71:8085`) is treated as trusted, consistent with other homelab services.
Never port-forward it raw.

### 2. Dev workflow: set up the Vite proxy in Phase 1

Day-to-day dev should be `yarn start` (Vite, HMR) + `node server/` running separately —
not Docker rebuilds. Add to `excalidraw-app/vite.config.mts` a dev-server proxy:
`/api` → `http://localhost:<server-port>`. Do this as part of Phase 1 or DX will hurt
for the whole project. (Vite config is an upstream file — keep the addition to a few
lines and add it to the fork surface manifest.)

### 3. ⚠️ localStorage/tabSync bleed-over (the Phase 2 trap)

The stock app assumes **one scene per browser**: it restores localStorage on load, and
`excalidraw-app/data/tabSync.ts` syncs that single scene across tabs via timestamp
versions. If a server file is open and this logic stays active:

- opening `#/d/a.excalidraw` after drawing on the scratch scene can restore scratch
  content into the server file (or vice versa),
- two tabs with two *different* server files will fight through tabSync.

Phase 2 must make the storage mode explicit: when a server file is open, **bypass**
localStorage restore-on-load and tabSync entirely (server + conflict guard handle
multi-tab in Phase 5). Scratch mode (`#/`-less) keeps stock behavior untouched.

### 4. Autosave cadence: don't PUT at 300ms

`SAVE_TO_LOCAL_STORAGE_TIMEOUT` is **300ms** — fine for localStorage, hostile for
network PUTs of scenes with embedded images (multi-MB payloads on every pen stroke).
Server saves need their own cadence: debounce ~3–5s, plus flush on `visibilitychange` /
tab close / route change to the dashboard. Skip the PUT when the serialized scene is
unchanged since last save.

### 5. Thumbnails affect API design — decide before Phase 3

Pure client-side thumbnails mean the dashboard downloads every full `.excalidraw` file
(embedded images included) just to render the grid — fine at 20 files, bad at 200.
Plan: client generates the SVG after each save and PUTs it to a
`/api/files/:path/thumbnail` endpoint; server stores it in a `.thumbnails/` dir keyed by
path + mtime and serves it with the file listing. Build the endpoint in Phase 1 (it's
trivial), wire it in Phase 3.

### 6. Free win: git-version the data dir

Drawings are plain JSON files — `git init` the data dir and auto-commit on a timer
(cron or a tiny loop in the server: commit if dirty every N minutes). That gives
version history for every drawing at zero app complexity — same philosophy as a notes
vault. Optional; can be added any time. Complements, not replaces, off-machine backups.

### 7. Scope discipline

The wrapper's value is the dashboard and file management — not editor customization.
Resist patching editor UI/behavior beyond the save hook; every editor patch grows the
merge surface permanently. Rule of thumb: if a feature idea requires touching
`packages/excalidraw/`, park it and reconsider.

---

## Phases

Work these in order. Each phase is a reasonable unit for one AI session.

### Phase 0 — Repo prep

- [ ] `git fetch upstream && git merge upstream/master` into `custom`; resolve conflicts; verify `yarn test:typecheck` passes
- [ ] Add `docker-compose.yml` at repo root: image `ghcr.io/victortolosa/excalidraw:latest`, volume `./data:/data`, port mapping (model it on NoteDiscovery's `docker-compose.ghcr.yml`)
- [ ] Commit and push; confirm GHCR build still green

**Verify:** fresh upstream merged, compose file exists, CI green.

### Phase 1 — Backend file API + Docker

- [ ] Scaffold `server/` (Node + Hono): static serving of `excalidraw-app/build` + the API table above
- [ ] Implement file listing/read/write/delete/rename with path sanitization
- [ ] Implement `GET/PUT /api/meta` backed by `.dashboard.json` in the data dir
- [ ] Thumbnail endpoint: `PUT/GET /api/files/:path/thumbnail` storing to `.thumbnails/` (see pre-flight #5)
- [ ] Vite dev proxy: `/api` → local server port in `vite.config.mts` (see pre-flight #2)
- [ ] Rewrite Dockerfile final stage: `node:24-alpine` running `server/`, replacing nginx; keep the build stage as-is
- [ ] Local test: `docker build` + run with a mounted dir; curl the API; confirm files appear on disk

**Verify:** `curl PUT` creates a `.excalidraw` file in the mounted directory; app still loads in browser.

### Phase 2 — Editor open/save wiring ⚠️ riskiest phase (touches upstream code)

- [ ] Add hash-route handling for `#/d/<path>` in `App.tsx` (follow the existing `#json=` pattern)
- [ ] Create `excalidraw-app/data/serverStorage.ts`: load scene from API on open; remember the `mtime` the server returns as the conflict baseline
- [ ] Branch inside the app-level `onChange` in `App.tsx` (~line 689): when a server file is open, call `serverStorage` save instead of stock `LocalData.save` — own debounce ~3–5s, flush on visibilitychange/route change, PUT the full scene (elements + appState subset + files), and **skip the PUT if the serialized scene is unchanged** (required, not optional — `onChange` fires on selection/viewport changes too; see pre-flight #4). Do **not** edit `LocalData._save`. On a successful PUT, refresh the stored `mtime` baseline from the response
- [ ] Bypass localStorage restore-on-load and tabSync when a server file is open (see pre-flight #3)
- [ ] Save-status indicator (saved / saving / error) in the UI
- [ ] Keep localStorage behavior intact when no server file is open

**Verify:** open `#/d/test.excalidraw`, draw, wait for debounce → file on disk updates; reload restores the drawing; plain `#/`-less usage still works as stock.

### Phase 3 — Dashboard MVP

- [ ] `excalidraw-app/dashboard/` route at `#/`: card grid listing files from the API
- [ ] Thumbnails: client generates SVG after save → PUT to thumbnail endpoint; dashboard grid loads thumbnails from server, not full files (see pre-flight #5)
- [ ] Create new drawing (name prompt → PUT empty scene → open editor)
- [ ] Rename, delete (with confirm), open
- [ ] Sort by name / modified date

**Verify:** full loop — create, draw, return to dashboard, see thumbnail, rename, reopen, delete.

### Phase 4 — Organization features

- [ ] Favorites: star toggle, persisted in `.dashboard.json`, favorites section on dashboard
- [ ] Folders: create/browse/move files (real directories in the data dir)
- [ ] Search: filename match + text-element content match (extract text from `.excalidraw` JSON server-side in the list endpoint, or client-side)
- [ ] Recents (last-opened, from metadata)
- [ ] Cmd+K quick switcher (port the NoteDiscovery idea)

**Verify:** favorite/unfavorite persists across restart; search finds a drawing by text inside it; Cmd+K opens files.

### Phase 5 — Polish & hardening

- [ ] Conflict guard: client sends its baseline mtime; server rejects PUT (409) if disk mtime is newer (covers two tabs / multi-device); UI offers reload-or-overwrite. The PUT response must return the new mtime so the client refreshes its baseline — otherwise the client false-conflicts against its *own* next save (the server bumps mtime on every write; see Phase 2 `serverStorage`)
- [ ] Dark mode parity for dashboard
- [ ] Backup script for the data dir (model on `~/Repos/jot/notediscovery-backup.ps1` or a simple cron rsync)
- [ ] Error states: server unreachable → editor falls back to localStorage with a banner
- [ ] Auth-expiry handling: when Cloudflare Access session expires mid-edit, API calls return a 302/HTML login page instead of JSON — detect non-JSON responses, show "session expired" banner, keep unsaved work in localStorage until re-auth (see Remote access section)
- [ ] Deploy to homelab; work through the "Remote access" checklist below

**Verify:** two-tab edit triggers the conflict UI; killing the server mid-edit doesn't lose work.

---

## Remote access: Cloudflare Tunnel + SSO

Sources of truth: `~/Repos/homelab/docs/operations/remote-access.md` and
`~/Repos/homelab/docs/source-of-truth.md`. Update those when anything here changes.

### Already in place (verified 2026-07-06 — nothing to build)

- Tunnel `homelab-i5` on `docker-i5` (10.0.0.71), connector at `/opt/stacks/cloudflared`,
  token server-local only.
- Public route: `draw.makeshit.app` → `http://127.0.0.1:8085`.
- Cloudflare Access app on that hostname: Google identity provider only
  ("Google - Homelab"), **exact Gmail addresses** in the policy — no `Everyone`, no
  email-domain matching, no bypass, no one-time PIN.
- The fork's image (`ghcr.io/victortolosa/excalidraw`, branch `custom`) is already the
  deployed container behind it.

### What changes when the backend lands (do alongside Phase 5 deploy)

Today the origin is a static nginx site — a misconfigured Access policy leaks nothing
interesting. Once `/api` exists, **Access becomes the sole remote security boundary**
for reads *and writes* to the data dir. Tasks:

- [ ] Verify the Access application covers the **entire hostname** (path filter empty,
      so `/api/*` is included), and re-confirm policy: Google only, exact emails,
      "accept all identity providers" off
- [ ] Set Access session duration deliberately (e.g. 1 week). Short sessions expire
      mid-edit and break autosave — the app-side mitigation is the Phase 5
      auth-expiry task, but a sane session length is the first line of defense
- [ ] Server sets `Cache-Control: no-store` on all `/api` responses (one middleware
      line) so Cloudflare/browsers never cache file contents or listings
- [ ] Server-side compose (`/opt/stacks/<excalidraw stack>`): add the data-dir volume;
      keep the LAN port binding as-is (`10.0.0.71:8085` stays reachable — trusted-LAN
      model, and Homepage links to it)
- [ ] Note the payload ceiling: Cloudflare proxies cap request bodies (~100MB on free
      plan). Fine for drawings; if a scene with embedded images ever hits it, the fix
      is trimming images, not raising the limit

### Deliberately NOT doing (documented so future sessions don't "fix" it)

- **No JWT validation of `Cf-Access-Jwt-Assertion` in the app.** It would break trusted
  LAN access (LAN requests don't traverse the tunnel, so they carry no JWT) and adds
  patch surface. If the threat model ever changes: bind the container to `127.0.0.1`,
  make all access tunnel-only, and add JWT verification behind a
  `REQUIRE_CF_ACCESS=true` env flag. Until then: Access guards remote, LAN is trusted.
- **No app-level login.** Unlike NoteDiscovery (which keeps its own auth behind
  Access), this app is Access-only remotely — same model as Calibre Web's anonymous
  browsing. Accepted trade-off.

### Optional later: service token for non-browser clients

Browser SSO blocks scripts, CLI, and MCP servers (an `excalidraw-mcp` in the spirit of
`notediscovery-mcp` is a natural future add). When needed:

1. Zero Trust → Access → Service Auth → create a service token for the client.
2. Add a second policy on the `draw.makeshit.app` Access app: action **Service Auth**,
   include that token.
3. Client sends `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers on every
   request; store the secret like the tunnel token (server-local, never committed).

### Homelab-repo housekeeping (in `~/Repos/homelab`, not this repo)

- [ ] Update `docs/operations/remote-access.md` Excalidraw section: auth model becomes
      "Cloudflare Access Google SSO → Excalidraw file API (no app auth; Access is the
      sole remote barrier)" and note where the data dir lives
- [ ] Update `docs/source-of-truth.md` / `docs/service-inventory.md`: data path, backup
      coverage
- [ ] Backups: put the data dir under the existing Restic coverage; optionally add a
      Syncthing share to the NAS like NoteDiscovery's
      (`/opt/homelab/docker/notediscovery/data` ↔ NAS docs share) — plain files make
      this symmetric

### Verification checklist (run after the Phase 5 deploy)

- [ ] Incognito browser → `https://draw.makeshit.app` → Google SSO prompt → dashboard loads
- [ ] Unauthenticated `curl -i https://draw.makeshit.app/api/files` → Access redirect/login
      page (302/HTML), **never** a JSON file listing
- [ ] After SSO in browser: full loop works remotely (create → draw → autosave → thumbnail)
- [ ] LAN `curl http://10.0.0.71:8085/api/files` → works without SSO (trusted-LAN model intact)
- [ ] `curl -sI` an authenticated `/api` response → `Cache-Control: no-store` present
- [ ] Simulate session expiry (delete the `CF_Authorization` cookie mid-edit) → app shows
      the session-expired banner, no drawing data lost

---

## Session template for future AI work

When starting a phase, prompt with something like:

> Read DASHBOARD_PLAN.md. We're on Phase N. Check off what's already done by inspecting
> the code, then implement the remaining tasks in that phase following the patch-hygiene
> rules. Run `yarn test:typecheck` and the phase's Verify step before finishing.

Keep this file updated: check boxes as tasks land, and record any decision changes in
the Decisions section with a date.
