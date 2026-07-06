import fs from "node:fs/promises";
import path from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { FILE_EXT, PathError, safeFilePath, safeFolderPath } from "./safePath.ts";

const THUMBNAIL_DIR = ".thumbnails";
const META_FILE = ".dashboard.json";

export interface FileEntry {
  path: string;
  name: string;
  folder: string;
  mtime: number;
  size: number;
  hasThumbnail: boolean;
}

const exists = async (p: string) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

/** Write via temp file + rename so a crash never leaves a torn file. */
async function atomicWrite(abs: string, content: string) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, abs);
}

async function listDrawings(dataDir: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  const walk = async (dir: string, rel: string) => {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // data dir may not exist yet
    }
    for (const dirent of dirents) {
      if (dirent.name.startsWith(".")) {
        continue;
      }
      const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        await walk(path.join(dir, dirent.name), childRel);
      } else if (dirent.isFile() && dirent.name.endsWith(FILE_EXT)) {
        const stat = await fs.stat(path.join(dir, dirent.name));
        entries.push({
          path: childRel,
          name: dirent.name.slice(0, -FILE_EXT.length),
          folder: rel,
          mtime: Math.round(stat.mtimeMs),
          size: stat.size,
          hasThumbnail: await exists(
            path.join(dataDir, THUMBNAIL_DIR, `${childRel}.svg`),
          ),
        });
      }
    }
  };

  await walk(dataDir, "");
  return entries;
}

async function listFolders(dataDir: string): Promise<
  { path: string; name: string }[]
> {
  const folders: { path: string; name: string }[] = [];

  const walk = async (dir: string, rel: string) => {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory() || dirent.name.startsWith(".")) {
        continue;
      }
      const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
      folders.push({ path: childRel, name: dirent.name });
      await walk(path.join(dir, dirent.name), childRel);
    }
  };

  await walk(dataDir, "");
  return folders;
}

/** does any text element in the drawing contain `query` (lowercased)? */
async function drawingTextMatches(abs: string, query: string) {
  try {
    const data = JSON.parse(await fs.readFile(abs, "utf8"));
    return (
      Array.isArray(data.elements) &&
      data.elements.some(
        (element: unknown) =>
          typeof (element as { text?: unknown })?.text === "string" &&
          (element as { text: string }).text.toLowerCase().includes(query),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Split the wildcard tail of `/api/files/*` into the drawing path and an
 * optional action suffix. Unambiguous because drawing paths must end in
 * `.excalidraw`: `a.excalidraw/thumbnail` → thumbnail of `a.excalidraw`.
 */
function parseFileRoute(raw: string): {
  rel: string;
  action: "file" | "thumbnail" | "rename";
} {
  for (const action of ["thumbnail", "rename"] as const) {
    if (raw.endsWith(`${FILE_EXT}/${action}`)) {
      return { rel: raw.slice(0, -(action.length + 1)), action };
    }
  }
  return { rel: raw, action: "file" };
}

export function createApp(options: { dataDir: string; staticDir: string }) {
  const dataDir = path.resolve(options.dataDir);
  const staticDir = path.resolve(options.staticDir);

  const thumbnailPath = (rel: string) =>
    path.join(dataDir, THUMBNAIL_DIR, `${rel}.svg`);

  const moveThumbnail = async (fromRel: string, toRel: string) => {
    const from = thumbnailPath(fromRel);
    if (await exists(from)) {
      const to = thumbnailPath(toRel);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
    }
  };

  const api = new Hono();

  api.use("*", async (c, next) => {
    await next();
    // Cloudflare/browsers must never cache file contents or listings
    c.header("Cache-Control", "no-store");
  });

  api.onError((err, c) => {
    if (err instanceof PathError) {
      return c.json({ error: err.message }, 400);
    }
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  api.get("/health", (c) => c.json({ ok: true }));

  api.get("/files", async (c) => {
    const files = await listDrawings(dataDir);
    const query = c.req.query("q")?.trim().toLowerCase();
    if (!query) {
      return c.json(files);
    }
    // search: filename match, else text-element content match
    const matches = [];
    for (const file of files) {
      if (
        file.name.toLowerCase().includes(query) ||
        (await drawingTextMatches(path.join(dataDir, file.path), query))
      ) {
        matches.push(file);
      }
    }
    return c.json(matches);
  });

  api.get("/folders", async (c) => c.json(await listFolders(dataDir)));

  api.get("/files/:path{.+}", async (c) => {
    const { rel, action } = parseFileRoute(c.req.param("path"));
    const { abs } = safeFilePath(dataDir, rel);

    if (action === "rename") {
      return c.json({ error: "rename is POST-only" }, 405);
    }
    if (action === "thumbnail") {
      const thumb = thumbnailPath(rel);
      if (!(await exists(thumb))) {
        return c.json({ error: "no thumbnail" }, 404);
      }
      c.header("Content-Type", "image/svg+xml");
      // user-generated SVG: never let it script if opened directly
      c.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      return c.body(await fs.readFile(thumb, "utf8"));
    }

    let content: string;
    let stat;
    try {
      [content, stat] = await Promise.all([
        fs.readFile(abs, "utf8"),
        fs.stat(abs),
      ]);
    } catch {
      return c.json({ error: "not found" }, 404);
    }
    c.header("Content-Type", "application/json");
    c.header("X-Mtime", String(Math.round(stat.mtimeMs)));
    return c.body(content);
  });

  api.put("/files/:path{.+}", async (c) => {
    const { rel, action } = parseFileRoute(c.req.param("path"));
    const { abs } = safeFilePath(dataDir, rel);
    const body = await c.req.text();

    if (action === "rename") {
      return c.json({ error: "rename is POST-only" }, 405);
    }
    if (action === "thumbnail") {
      if (!body.includes("<svg")) {
        return c.json({ error: "thumbnail must be SVG" }, 400);
      }
      await atomicWrite(thumbnailPath(rel), body);
      return c.json({ ok: true });
    }

    try {
      JSON.parse(body);
    } catch {
      return c.json({ error: "body must be valid JSON" }, 400);
    }
    await atomicWrite(abs, body);
    const stat = await fs.stat(abs);
    return c.json({ mtime: Math.round(stat.mtimeMs), size: stat.size });
  });

  api.post("/files/:path{.+}", async (c) => {
    const { rel, action } = parseFileRoute(c.req.param("path"));
    if (action !== "rename") {
      return c.json({ error: "unknown action" }, 404);
    }
    const from = safeFilePath(dataDir, rel);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.to !== "string") {
      return c.json({ error: "body must be {\"to\": \"new/path.excalidraw\"}" }, 400);
    }
    const to = safeFilePath(dataDir, body.to);

    if (!(await exists(from.abs))) {
      return c.json({ error: "not found" }, 404);
    }
    if (await exists(to.abs)) {
      return c.json({ error: "target already exists" }, 409);
    }
    await fs.mkdir(path.dirname(to.abs), { recursive: true });
    await fs.rename(from.abs, to.abs);
    await moveThumbnail(from.rel, to.rel);
    const stat = await fs.stat(to.abs);
    return c.json({ path: to.rel, mtime: Math.round(stat.mtimeMs) });
  });

  api.delete("/files/:path{.+}", async (c) => {
    const { rel, action } = parseFileRoute(c.req.param("path"));
    const { abs } = safeFilePath(dataDir, rel);
    if (action !== "file") {
      return c.json({ error: "unknown action" }, 404);
    }
    try {
      await fs.unlink(abs);
    } catch {
      return c.json({ error: "not found" }, 404);
    }
    await fs.rm(thumbnailPath(rel), { force: true });
    return c.json({ ok: true });
  });

  api.post("/folders/:path{.+}", async (c) => {
    const { abs } = safeFolderPath(dataDir, c.req.param("path"));
    await fs.mkdir(abs, { recursive: true });
    return c.json({ ok: true });
  });

  api.delete("/folders/:path{.+}", async (c) => {
    const { abs } = safeFolderPath(dataDir, c.req.param("path"));
    try {
      await fs.rmdir(abs); // non-recursive on purpose
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        return c.json({ error: "not found" }, 404);
      }
      if (err?.code === "ENOTEMPTY") {
        return c.json({ error: "folder not empty" }, 409);
      }
      throw err;
    }
    return c.json({ ok: true });
  });

  api.get("/meta", async (c) => {
    try {
      const raw = await fs.readFile(path.join(dataDir, META_FILE), "utf8");
      return c.json(JSON.parse(raw));
    } catch {
      return c.json({});
    }
  });

  api.put("/meta", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return c.json({ error: "body must be a JSON object" }, 400);
    }
    await atomicWrite(
      path.join(dataDir, META_FILE),
      JSON.stringify(body, null, 2),
    );
    return c.json({ ok: true });
  });

  const app = new Hono();
  app.route("/api", api);

  // static frontend + SPA fallback (routing is hash-based, so "/" is the only
  // real document, but be liberal)
  const staticRoot = path.relative(process.cwd(), staticDir) || ".";
  app.use("*", serveStatic({ root: staticRoot }));
  app.get("*", serveStatic({ root: staticRoot, path: "index.html" }));

  return app;
}
