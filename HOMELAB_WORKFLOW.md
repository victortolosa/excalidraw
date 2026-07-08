# Homelab workflow

## Purpose

This fork is the patched source for the self-hosted Excalidraw instance running on `docker-i5`.

The server does not build Excalidraw. The server only pulls and runs a Docker image built by GitHub Actions.

> **This is a personal fork — never open a PR against `excalidraw/excalidraw` and never
> push to `upstream`.** See [FORK_POLICY.md](FORK_POLICY.md) for the full policy and how
> to enforce it locally.

## System map

```text
/Users/victortolosa/Repos/excalidraw
  source fork
  branch: custom

GitHub
  repo: victortolosa/excalidraw
  branch: custom
  workflow: .github/workflows/build-custom.yml

GitHub Actions
  builds Dockerfile
  publishes image to GHCR

GHCR
  image: ghcr.io/victortolosa/excalidraw:latest
  immutable image tags: ghcr.io/victortolosa/excalidraw:<commit-sha>

docker-i5
  stack path: /opt/stacks/excalidraw
  local URL: http://10.0.0.71:8085
  remote URL: https://draw.makeshit.app
```

## Repositories

### Excalidraw fork

Use this repo for source patches:

```text
/Users/victortolosa/Repos/excalidraw
https://github.com/victortolosa/excalidraw
```

Keep custom work on:

```text
custom
```

Remotes:

```text
origin   https://github.com/victortolosa/excalidraw.git
upstream https://github.com/excalidraw/excalidraw.git
```

`upstream` should be treated as read-only.

### Homelab repo

Use the homelab repo for deployment docs and operational context:

```text
/Users/victortolosa/Repos/homelab
```

Main references:

```text
docs/apps/excalidraw.md
docs/operations/git-deploy.md
docs/source-of-truth.md
```

The live stack IS Git-managed (since 2026-07-06): the compose template lives in the homelab repo at `docker-services/excalidraw/compose.yml` (sha-pinned image, data volume) and deploys with `./deploy/docker-stacks/deploy.sh excalidraw`. The earlier "stay server-owned" decision was superseded when the dashboard/file API gave the compose file real config to version.

## Build workflow

The GitHub Actions workflow is:

```text
.github/workflows/build-custom.yml
```

It runs on:

```text
push to custom
manual workflow_dispatch
```

It does this:

1. Checks out the source.
2. Sets up Docker Buildx.
3. Logs in to GitHub Container Registry with `GITHUB_TOKEN`.
4. Builds the root `Dockerfile`.
5. Pushes the image to GHCR.

Current image tags:

```text
ghcr.io/victortolosa/excalidraw:latest
ghcr.io/victortolosa/excalidraw:${{ github.sha }}
```

The SHA tag is safer for rollback. The `latest` tag is convenient for normal pulls.

## Docker image

The root `Dockerfile` builds the Excalidraw app, then runs the fork's Node
server from `server/`. The Node server serves both the static app and the
`/api` file dashboard endpoints.

Runtime behavior:

```text
container port: 80
server host port: 8085
```

The compose file on `docker-i5` should publish:

```yaml
ports:
  - "8085:80"
```

Do not add `build:` to the server compose file. That would move the expensive frontend build back onto the server.

## Patch workflow

Use this for normal custom source changes:

```bash
cd /Users/victortolosa/Repos/excalidraw
git checkout custom
git status
```

Make the patch, then run relevant checks. For small UI/source patches, start with:

```bash
yarn test --watch=false
```

If the patch affects app build behavior, also run:

```bash
yarn build:app:docker
```

Commit and push:

```bash
git add .
git commit -m "Describe custom patch"
git push origin custom
```

After push, confirm the `build-and-push` workflow succeeded in GitHub Actions.

## Server deploy workflow

This stack is SHA-pinned on purpose. A source push to `custom` creates a new
GHCR image, but the i5 server will keep pulling the old image until the homelab
compose file is bumped to the new SHA tag.

After GitHub Actions publishes the image, update the homelab repo first:

```bash
cd ~/Repos/homelab
$EDITOR docker-services/excalidraw/compose.yml
```

Set:

```yaml
image: ghcr.io/victortolosa/excalidraw:<new-excalidraw-commit-sha>
```

Then commit and push the homelab config change:

```bash
git diff docker-services/excalidraw/compose.yml
git commit -am "Update Excalidraw image"
git push
```

Only then deploy on `docker-i5`:

```bash
ssh victor@10.0.0.71
cd ~/homelab
git pull
./deploy/docker-stacks/deploy.sh excalidraw
docker logs excalidraw --tail=50
curl -s http://127.0.0.1:8085/api/health
```

If `git pull` appears to work but the UI is still old, check the image tag:

```bash
grep -n "image:" ~/homelab/docker-services/excalidraw/compose.yml /opt/stacks/excalidraw/compose.yml
```

If it still points at an older SHA, the homelab repo has not been bumped yet.
`docker compose pull` pulls the image named in the compose file; it does not
discover newer Excalidraw source commits automatically.

`/opt/stacks/excalidraw/compose.yml` is only a deployed copy of the homelab
template. If `/opt/stacks/excalidraw/docker-compose.yml` also exists, archive
it once (`mv docker-compose.yml docker-compose.yml.old`) so Docker Compose does
not warn about multiple default compose files.

Open:

```text
http://10.0.0.71:8085
https://draw.makeshit.app
```

If managing the stack through Dockge, use Dockge to pull and recreate the stack instead of running the compose commands manually.

## Rollback workflow

Prefer rollback by immutable image tag.

1. Find the last good commit SHA from GitHub Actions or GHCR.
2. Edit `/opt/stacks/excalidraw/compose.yml` on `docker-i5`.
3. Temporarily set:

```yaml
image: ghcr.io/victortolosa/excalidraw:<commit-sha>
```

4. Recreate:

```bash
cd /opt/stacks/excalidraw
docker compose pull excalidraw
docker compose up -d --force-recreate excalidraw
curl -I http://127.0.0.1:8085
```

After the broken `custom` branch is fixed and a new good image is published, switch the compose file back to:

```yaml
image: ghcr.io/victortolosa/excalidraw:latest
```

## Updating from upstream

Use the upstream sync runbook in [DASHBOARD_PLAN.md](DASHBOARD_PLAN.md):
**merge, never rebase** — `custom` is pushed and deployed, so history must
not be rewritten. Sync at phase boundaries only.

```bash
cd /Users/victortolosa/Repos/excalidraw
git fetch upstream
git checkout custom
git merge upstream/master
```

Resolve conflicts per the plan's conflict playbook, run its post-merge
verification checklist, then `git push origin custom`.

## Boundaries

### Do

- Keep custom patches as readable source commits.
- Keep the server compose file image-based.
- Use GitHub Actions for builds.
- Use SHA tags for rollback.
- Keep the homelab repo as the deployment runbook.

### Do not

- Do not edit built or minified files.
- Do not edit files inside the running container.
- Do not build Excalidraw on `docker-i5` unless the image pipeline is broken and there is no better option.
- Do not add collaboration services as part of a small UI patch.
- Do not add NAS storage mounts unless the storage/collaboration architecture is being intentionally redesigned.
- Do not commit secrets, tokens, `.env` files, or server-only config.

## Collaboration and storage

The current deployment is a static Excalidraw app served by nginx.

Real-time collaboration is a separate system. It requires additional backend and routing decisions. Do not treat it as part of the normal patch workflow.

NAS-backed storage is also deferred. Browser-local storage is the current baseline.

## Troubleshooting

### Workflow did not run

Check that the push went to:

```text
origin custom
```

The workflow does not run for arbitrary local branches unless manually dispatched.

### GHCR pull fails on server

Likely causes:

- The package is private and the server is not logged in to GHCR.
- The workflow failed and no new image was pushed.
- The image tag in compose does not exist.

Public packages can be pulled without Docker login. Private packages require a token with `read:packages`.

### Server still shows old app

Run:

```bash
cd /opt/stacks/excalidraw
docker compose pull excalidraw
docker compose up -d --force-recreate excalidraw
docker image inspect ghcr.io/victortolosa/excalidraw:latest
```

Also clear browser cache or test in a private window if the app shell looks stale.

### Build fails after upstream rebase

Start with:

```bash
yarn install --frozen-lockfile
yarn build:app:docker
```

If the failure is from the Docker build but local build works, inspect `.dockerignore`, the root `Dockerfile`, and the GitHub Actions log.

## External references checked

Checked on 2026-06-29:

- GitHub Container Registry supports publishing container images from GitHub Actions with `GITHUB_TOKEN` when workflow permissions include `packages: write`.
- Docker's build action examples currently use `docker/build-push-action@v7`, `docker/login-action@v4`, and `docker/setup-buildx-action@v4`.
- `docker compose pull` pulls service images defined in the compose file before recreate/start.

References:

- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- https://github.com/docker/build-push-action
- https://github.com/docker/login-action
- https://github.com/docker/setup-buildx-action
- https://docs.docker.com/reference/cli/docker/compose/pull/
