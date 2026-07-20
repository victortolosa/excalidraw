import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { createApp } from "./app.ts";

let dataDir: string;
let app: ReturnType<typeof createApp>;

const SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
  files: {},
});

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "exc-server-test-"));
  app = createApp({ dataDir, staticDir: path.join(dataDir, "no-static") });
});

after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

test("health", async () => {
  const res = await app.request("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("PUT creates a file on disk, returns mtime; GET reads it back", async () => {
  const put = await app.request("/api/files/sub/a.excalidraw", {
    method: "PUT",
    body: SCENE,
  });
  assert.equal(put.status, 200);
  const { mtime } = await put.json();
  assert.equal(typeof mtime, "number");

  const onDisk = await fs.readFile(
    path.join(dataDir, "sub/a.excalidraw"),
    "utf8",
  );
  assert.equal(onDisk, SCENE);

  const get = await app.request("/api/files/sub/a.excalidraw");
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("x-mtime"), String(mtime));
  assert.equal(await get.text(), SCENE);
});

test("all /api responses carry Cache-Control: no-store", async () => {
  for (const url of ["/api/health", "/api/files", "/api/meta"]) {
    const res = await app.request(url);
    assert.equal(res.headers.get("cache-control"), "no-store", url);
  }
});

test("listing includes files dropped into the data dir", async () => {
  await fs.writeFile(path.join(dataDir, "dropped.excalidraw"), SCENE);
  const res = await app.request("/api/files");
  const files = await res.json();
  const dropped = files.find((f: any) => f.path === "dropped.excalidraw");
  assert.ok(dropped);
  assert.equal(dropped.name, "dropped");
  assert.equal(dropped.folder, "");
  assert.equal(typeof dropped.mtime, "number");
  assert.equal(dropped.hasThumbnail, false);
  // dotfiles never appear
  await fs.writeFile(path.join(dataDir, ".dashboard.json"), "{}");
  const again = await (await app.request("/api/files")).json();
  assert.ok(again.every((f: any) => !f.path.startsWith(".")));
});

test("PUT rejects invalid JSON and bad paths", async () => {
  const bad = await app.request("/api/files/bad.excalidraw", {
    method: "PUT",
    body: "not json",
  });
  assert.equal(bad.status, 400);

  const traversal = await app.request("/api/files/..%2F..%2Fetc%2Fpasswd", {
    method: "PUT",
    body: SCENE,
  });
  assert.equal(traversal.status, 400);

  const wrongExt = await app.request("/api/files/foo.txt", {
    method: "PUT",
    body: SCENE,
  });
  assert.equal(wrongExt.status, 400);
});

test("thumbnail PUT/GET round-trip, stored under .thumbnails", async () => {
  const svg = "<svg xmlns='http://www.w3.org/2000/svg'></svg>";
  const put = await app.request("/api/files/sub/a.excalidraw/thumbnail", {
    method: "PUT",
    headers: { "Content-Type": "image/svg+xml" },
    body: svg,
  });
  assert.equal(put.status, 200);
  assert.ok(
    await fs
      .access(path.join(dataDir, ".thumbnails/sub/a.excalidraw.svg"))
      .then(() => true),
  );

  const get = await app.request("/api/files/sub/a.excalidraw/thumbnail");
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "image/svg+xml");
  assert.equal(get.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await get.text(), svg);

  const listed = await (await app.request("/api/files")).json();
  assert.equal(
    listed.find((f: any) => f.path === "sub/a.excalidraw").hasThumbnail,
    true,
  );
});

test("listing treats old thumbnails as stale", async () => {
  await app.request("/api/files/stale-thumbnail.excalidraw", {
    method: "PUT",
    body: SCENE,
  });
  await app.request("/api/files/stale-thumbnail.excalidraw/thumbnail", {
    method: "PUT",
    headers: { "Content-Type": "image/svg+xml" },
    body: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
  });

  let listed = await (await app.request("/api/files")).json();
  assert.equal(
    listed.find((f: any) => f.path === "stale-thumbnail.excalidraw")
      .hasThumbnail,
    true,
  );

  await new Promise((resolve) => setTimeout(resolve, 10));
  await app.request("/api/files/stale-thumbnail.excalidraw", {
    method: "PUT",
    body: SCENE.replace("[]", "[ ]"),
  });

  listed = await (await app.request("/api/files")).json();
  assert.equal(
    listed.find((f: any) => f.path === "stale-thumbnail.excalidraw")
      .hasThumbnail,
    false,
  );

  await app.request("/api/files/stale-thumbnail.excalidraw", {
    method: "DELETE",
  });
});

test("thumbnail PUT rejects non-SVG and oversized payloads", async () => {
  const notSvg = await app.request("/api/files/sub/a.excalidraw/thumbnail", {
    method: "PUT",
    headers: { "Content-Type": "text/html" },
    body: "<html></html>",
  });
  assert.equal(notSvg.status, 400);

  const oversized = await app.request("/api/files/sub/a.excalidraw/thumbnail", {
    method: "PUT",
    headers: { "Content-Type": "image/svg+xml" },
    body: `<svg>${"x".repeat(1_000_001)}</svg>`,
  });
  assert.equal(oversized.status, 400);
});

test("rename moves file and thumbnail on disk", async () => {
  const res = await app.request("/api/files/sub/a.excalidraw/rename", {
    method: "POST",
    body: JSON.stringify({ to: "moved/b.excalidraw" }),
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(res.status, 200);
  const { path: newPath, mtime } = await res.json();
  assert.equal(newPath, "moved/b.excalidraw");
  assert.equal(typeof mtime, "number");
  await fs.access(path.join(dataDir, "moved/b.excalidraw"));
  await fs.access(path.join(dataDir, ".thumbnails/moved/b.excalidraw.svg"));
  assert.equal((await app.request("/api/files/sub/a.excalidraw")).status, 404);
});

test("rename onto an existing file is a 409", async () => {
  const res = await app.request("/api/files/moved/b.excalidraw/rename", {
    method: "POST",
    body: JSON.stringify({ to: "dropped.excalidraw" }),
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(res.status, 409);
});

test("DELETE removes file and its thumbnail", async () => {
  const res = await app.request("/api/files/moved/b.excalidraw", {
    method: "DELETE",
  });
  assert.equal(res.status, 200);
  assert.equal(
    (await app.request("/api/files/moved/b.excalidraw")).status,
    404,
  );
  await assert.rejects(
    fs.access(path.join(dataDir, ".thumbnails/moved/b.excalidraw.svg")),
  );
  const again = await app.request("/api/files/moved/b.excalidraw", {
    method: "DELETE",
  });
  assert.equal(again.status, 404);
});

test("folders: create makes a real dir, delete only when empty", async () => {
  const mk = await app.request("/api/folders/projects/2026", {
    method: "POST",
  });
  assert.equal(mk.status, 200);
  const stat = await fs.stat(path.join(dataDir, "projects/2026"));
  assert.ok(stat.isDirectory());

  await fs.writeFile(path.join(dataDir, "projects/2026/x.excalidraw"), SCENE);
  const notEmpty = await app.request("/api/folders/projects/2026", {
    method: "DELETE",
  });
  assert.equal(notEmpty.status, 409);

  await fs.unlink(path.join(dataDir, "projects/2026/x.excalidraw"));
  const rm = await app.request("/api/folders/projects/2026", {
    method: "DELETE",
  });
  assert.equal(rm.status, 200);

  const dotDir = await app.request("/api/folders/.thumbnails", {
    method: "DELETE",
  });
  assert.equal(dotDir.status, 400);
});

test("search matches filename and text-element content", async () => {
  const withText = JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [{ type: "text", text: "Quarterly Roadmap 2026" }],
    appState: {},
    files: {},
  });
  await app.request("/api/files/notes.excalidraw", {
    method: "PUT",
    body: withText,
  });
  await app.request("/api/files/unrelated.excalidraw", {
    method: "PUT",
    body: SCENE,
  });

  // filename match
  const byName = await (await app.request("/api/files?q=notes")).json();
  assert.deepEqual(
    byName.map((f: any) => f.path),
    ["notes.excalidraw"],
  );

  // content match, case-insensitive
  const byText = await (await app.request("/api/files?q=roadmap")).json();
  assert.deepEqual(
    byText.map((f: any) => f.path),
    ["notes.excalidraw"],
  );

  const none = await (await app.request("/api/files?q=zzznope")).json();
  assert.deepEqual(none, []);

  await app.request("/api/files/notes.excalidraw", { method: "DELETE" });
  await app.request("/api/files/unrelated.excalidraw", { method: "DELETE" });
});

test("GET /api/folders lists real dirs, including empty ones", async () => {
  await app.request("/api/folders/archive/2025", { method: "POST" });
  const folders = await (await app.request("/api/folders")).json();
  const paths = folders.map((f: any) => f.path);
  assert.ok(paths.includes("archive"));
  assert.ok(paths.includes("archive/2025"));
  // dot-dirs (.thumbnails) never appear
  assert.ok(paths.every((p: string) => !p.startsWith(".")));
  await app.request("/api/folders/archive/2025", { method: "DELETE" });
  await app.request("/api/folders/archive", { method: "DELETE" });
});

test("GET and PUT expose a content ETag; PUT returns a version", async () => {
  const put = await app.request("/api/files/etag.excalidraw", {
    method: "PUT",
    body: SCENE,
  });
  const { version } = await put.json();
  assert.equal(typeof version, "string");
  assert.equal(put.headers.get("etag"), version);

  const get = await app.request("/api/files/etag.excalidraw");
  assert.equal(get.headers.get("etag"), version);

  // same bytes → same validator; different bytes → different validator
  const same = await app.request("/api/files/etag.excalidraw", {
    method: "PUT",
    body: SCENE,
  });
  assert.equal((await same.json()).version, version);
  const changed = await app.request("/api/files/etag.excalidraw", {
    method: "PUT",
    body: SCENE.replace("[]", "[ ]"),
  });
  assert.notEqual((await changed.json()).version, version);

  await app.request("/api/files/etag.excalidraw", { method: "DELETE" });
});

test("conflict guard: 409 when the on-disk version differs from the baseline", async () => {
  const put1 = await app.request("/api/files/conflict.excalidraw", {
    method: "PUT",
    body: SCENE,
  });
  const { version: baseline } = await put1.json();

  // another writer changes the file, so its version no longer matches
  const put2 = await app.request("/api/files/conflict.excalidraw", {
    method: "PUT",
    body: SCENE.replace("[]", "[ ]"),
  });
  const { version: current } = await put2.json();

  const stale = await app.request("/api/files/conflict.excalidraw", {
    method: "PUT",
    body: SCENE,
    headers: { "X-Base-Version": baseline },
  });
  assert.equal(stale.status, 409);
  const conflictBody = await stale.json();
  assert.equal(conflictBody.version, current);

  // the current baseline writes fine and returns the fresh version
  const ok = await app.request("/api/files/conflict.excalidraw", {
    method: "PUT",
    body: SCENE,
    headers: { "X-Base-Version": current },
  });
  assert.equal(ok.status, 200);

  // no header = unconditional overwrite; a baseline for a missing file writes
  // as a re-create rather than conflicting
  const force = await app.request("/api/files/conflict.excalidraw", {
    method: "PUT",
    body: SCENE,
  });
  assert.equal(force.status, 200);
  const fresh = await app.request("/api/files/brand-new.excalidraw", {
    method: "PUT",
    body: SCENE,
    headers: { "X-Base-Version": '"whatever"' },
  });
  assert.equal(fresh.status, 200);

  await app.request("/api/files/conflict.excalidraw", { method: "DELETE" });
  await app.request("/api/files/brand-new.excalidraw", { method: "DELETE" });
});

test("concurrent same-file PUTs: one wins, one conflicts, no server errors", async () => {
  const seed = await app.request("/api/files/race.excalidraw", {
    method: "PUT",
    body: SCENE,
  });
  const { version: baseline } = await seed.json();

  // both writers loaded the same baseline and fire at once
  const [a, b] = await Promise.all([
    app.request("/api/files/race.excalidraw", {
      method: "PUT",
      body: SCENE.replace("[]", "[1]"),
      headers: { "X-Base-Version": baseline },
    }),
    app.request("/api/files/race.excalidraw", {
      method: "PUT",
      body: SCENE.replace("[]", "[2]"),
      headers: { "X-Base-Version": baseline },
    }),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);

  await app.request("/api/files/race.excalidraw", { method: "DELETE" });
});

test("concurrent PUTs to different files both succeed", async () => {
  const [a, b] = await Promise.all([
    app.request("/api/files/par-a.excalidraw", { method: "PUT", body: SCENE }),
    app.request("/api/files/par-b.excalidraw", { method: "PUT", body: SCENE }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  await app.request("/api/files/par-a.excalidraw", { method: "DELETE" });
  await app.request("/api/files/par-b.excalidraw", { method: "DELETE" });
});

test("writes leave no temp files behind", async () => {
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      app.request(`/api/files/tmp-${i}.excalidraw`, {
        method: "PUT",
        body: SCENE.replace("[]", `[${i}]`),
      }),
    ),
  );
  const names = await fs.readdir(dataDir);
  assert.equal(
    names.some((n) => n.includes(".tmp-")),
    false,
    `unexpected temp files: ${names.join(", ")}`,
  );
  await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      app.request(`/api/files/tmp-${i}.excalidraw`, { method: "DELETE" }),
    ),
  );
});

test("meta round-trips through .dashboard.json", async () => {
  const blob = { favorites: ["dropped.excalidraw"], order: "mtime" };
  const put = await app.request("/api/meta", {
    method: "PUT",
    body: JSON.stringify(blob),
    headers: { "Content-Type": "application/json" },
  });
  assert.equal(put.status, 200);
  assert.deepEqual(await (await app.request("/api/meta")).json(), blob);
  // stored as the dotfile, which the listing hides
  await fs.access(path.join(dataDir, ".dashboard.json"));
});
