import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { createApp } from "./app.ts";

const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
const staticDir = path.resolve(
  process.env.STATIC_DIR ??
    fileURLToPath(new URL("../../excalidraw-app/build", import.meta.url)),
);
const port = Number(process.env.PORT ?? 3011);

await fs.mkdir(dataDir, { recursive: true });
try {
  await fs.access(staticDir);
} catch {
  console.warn(
    `static dir ${staticDir} not found — API only (build the app or set STATIC_DIR)`,
  );
}

serve({ fetch: createApp({ dataDir, staticDir }).fetch, port });

console.log(`excalidraw-server listening on :${port}`);
console.log(`  data:   ${dataDir}`);
console.log(`  static: ${staticDir}`);
