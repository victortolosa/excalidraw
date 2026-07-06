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
  assert.equal(await get.text(), svg);

  const listed = await (await app.request("/api/files")).json();
  assert.equal(
    listed.find((f: any) => f.path === "sub/a.excalidraw").hasThumbnail,
    true,
  );
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
  assert.equal(
    (await app.request("/api/files/sub/a.excalidraw")).status,
    404,
  );
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

  await fs.writeFile(
    path.join(dataDir, "projects/2026/x.excalidraw"),
    SCENE,
  );
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
