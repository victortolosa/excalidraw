# Fork policy

**This is a personal fork. It exists only to carry private, self-hosted patches for one
homelab deployment. It is not a contribution staging area for upstream Excalidraw.**

## The one hard rule

**Never open a pull request against `excalidraw/excalidraw`. Never push to the `upstream`
remote.**

The patches on the `custom` branch (homelab docs, the self-hosted dashboard, deployment
wiring) are intentionally specific to one person's setup. They are not general-purpose,
they are not upstream-shaped, and they should never be proposed to the public project.

If you genuinely build something worth upstreaming, that is a **separate effort**: start
from a clean branch off `upstream/master` with none of the personal/homelab code in it,
and open the PR from there. Do not route it through `custom`.

## How the remotes are meant to flow

```text
excalidraw/excalidraw (upstream)  ──fetch/merge──►  custom  ──push──►  origin (your fork)
        READ-ONLY                                                          │
        never push, never PR                                              build
                                                                           ▼
                                                          ghcr.io/victortolosa/excalidraw
```

- `upstream` (excalidraw/excalidraw): **read-only.** Fetch and merge *from* it only.
- `origin` (victortolosa/excalidraw): your fork. Push `custom` here; this triggers the
  GHCR image build.
- Direction is strictly upstream → `custom`. Nothing ever flows `custom` → upstream.

See the upstream sync runbook in [DASHBOARD_PLAN.md](DASHBOARD_PLAN.md) for *how* to pull
upstream changes in safely (merge, never rebase; sync at phase boundaries only).

## Enforce it locally (recommended)

Disable the push URL on the `upstream` remote so an accidental `git push upstream` fails
fast instead of contacting the public repo:

```bash
git remote set-url --push upstream DISABLED
```

Verify:

```bash
git remote -v
# upstream  https://github.com/excalidraw/excalidraw.git (fetch)
# upstream  DISABLED (push)
```

Optional belt-and-suspenders — a local pre-push hook that refuses any push whose remote
URL points at `excalidraw/excalidraw`. Keep it in `.git/hooks/pre-push` (hooks are not
committed, so this is per-clone):

```sh
#!/bin/sh
# .git/hooks/pre-push — block pushes to the upstream project
remote_url="$2"
case "$remote_url" in
  *excalidraw/excalidraw*)
    echo "Refusing to push to upstream excalidraw/excalidraw (personal fork — see FORK_POLICY.md)." >&2
    exit 1
    ;;
esac
```

Then `chmod +x .git/hooks/pre-push`.

## Do / do not

### Do
- Keep all custom work on the `custom` branch.
- Fetch and merge from `upstream` to stay current (upstream → `custom` only).
- Push `custom` to `origin` to build and deploy your own image.

### Do not
- Do not open a PR to `excalidraw/excalidraw` from any branch that carries homelab code.
- Do not push to `upstream`.
- Do not commit secrets, tokens, `.env` files, or the mounted data dir — see
  "Private details" below and the repo `.gitignore`.

## Private details

This repo's homelab/deployment docs ([HOMELAB_WORKFLOW.md](HOMELAB_WORKFLOW.md),
[DASHBOARD_PLAN.md](DASHBOARD_PLAN.md), [DASHBOARD_STEPS.md](DASHBOARD_STEPS.md)) contain
setup-specific values (a LAN IP, a hostname, local paths). Those are deliberately kept in
this **private** fork and must never appear in anything upstream-facing.

Things that must **never** be committed at all — enforced by `.gitignore`:

- `.env*` / `.env*.local` — environment files.
- The mounted **data dir** (`/data/`) — drawings, `.dashboard.json`, `.thumbnails/`.
  This is user content, not source; back it up separately (see DASHBOARD_PLAN.md Phase 5),
  don't check it into the fork.
- Local compose overrides (`docker-compose.override.yml`, `*.local.yml`).
- Any token or secret file (Cloudflare tunnel token, GHCR PAT, Access service tokens).
  These live server-local only.

If you ever need to share a snippet of these docs publicly, redact the IP, hostname, and
paths first.
