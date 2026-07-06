import assert from "node:assert/strict";
import { test } from "node:test";

import { PathError, safeFilePath, safeFolderPath } from "./safePath.ts";

const ROOT = "/srv/data";

test("safeFilePath allows a root-level drawing", () => {
  const { rel, abs } = safeFilePath(ROOT, "a.excalidraw");
  assert.equal(rel, "a.excalidraw");
  assert.equal(abs, "/srv/data/a.excalidraw");
});

test("safeFilePath allows a nested drawing", () => {
  const { rel, abs } = safeFilePath(ROOT, "sub/a.excalidraw");
  assert.equal(rel, "sub/a.excalidraw");
  assert.equal(abs, "/srv/data/sub/a.excalidraw");
});

test("safeFilePath rejects traversal", () => {
  assert.throws(() => safeFilePath(ROOT, "../../etc/passwd"), PathError);
  assert.throws(() => safeFilePath(ROOT, "a/../b.excalidraw"), PathError);
  assert.throws(() => safeFilePath(ROOT, ".."), PathError);
  // what "%2e%2e/x.excalidraw" decodes to by the time it reaches us
  assert.throws(() => safeFilePath(ROOT, "../x.excalidraw"), PathError);
});

test("safeFilePath rejects absolute paths", () => {
  assert.throws(() => safeFilePath(ROOT, "/etc/passwd"), PathError);
  assert.throws(() => safeFilePath(ROOT, "/srv/data/a.excalidraw"), PathError);
});

test("safeFilePath rejects wrong extensions", () => {
  assert.throws(() => safeFilePath(ROOT, "foo.txt"), PathError);
  assert.throws(() => safeFilePath(ROOT, "foo"), PathError);
  assert.throws(() => safeFilePath(ROOT, "foo.EXCALIDRAW"), PathError);
  // extension alone is not a filename
  assert.throws(() => safeFilePath(ROOT, ".excalidraw"), PathError);
});

test("safeFilePath rejects dot-prefixed segments", () => {
  assert.throws(() => safeFilePath(ROOT, ".dashboard.json"), PathError);
  assert.throws(() => safeFilePath(ROOT, ".thumbnails/a.excalidraw"), PathError);
  assert.throws(() => safeFilePath(ROOT, "sub/.hidden/a.excalidraw"), PathError);
});

test("safeFilePath rejects malformed input", () => {
  assert.throws(() => safeFilePath(ROOT, ""), PathError);
  assert.throws(() => safeFilePath(ROOT, "a\0b.excalidraw"), PathError);
  assert.throws(() => safeFilePath(ROOT, "a\\b.excalidraw"), PathError);
  assert.throws(() => safeFilePath(ROOT, "a//b.excalidraw"), PathError);
  assert.throws(
    () => safeFilePath(ROOT, `${"x".repeat(1025)}.excalidraw`),
    PathError,
  );
});

test("safeFolderPath allows nested folders, no extension required", () => {
  const { rel, abs } = safeFolderPath(ROOT, "projects/2026");
  assert.equal(rel, "projects/2026");
  assert.equal(abs, "/srv/data/projects/2026");
});

test("safeFolderPath rejects traversal and dot-prefixed names", () => {
  assert.throws(() => safeFolderPath(ROOT, ".."), PathError);
  assert.throws(() => safeFolderPath(ROOT, "../outside"), PathError);
  assert.throws(() => safeFolderPath(ROOT, ".thumbnails"), PathError);
  assert.throws(() => safeFolderPath(ROOT, ".git"), PathError);
  assert.throws(() => safeFolderPath(ROOT, "/abs"), PathError);
});
