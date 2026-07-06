import path from "node:path";

export const FILE_EXT = ".excalidraw";

/** Client-supplied path was rejected — always map to a 400. */
export class PathError extends Error {}

/**
 * Validate a client-supplied relative path and return `{ rel, abs }` with
 * `abs` resolved strictly under `rootDir`.
 *
 * Rejects: absolute paths, `..`, empty/`.` segments, backslashes, null bytes,
 * and any dot-prefixed segment (protects `.dashboard.json`, `.thumbnails/`,
 * `.git/` inside the data dir).
 */
function validateRelPath(rootDir: string, input: string): {
  rel: string;
  abs: string;
} {
  if (typeof input !== "string" || input.length === 0) {
    throw new PathError("empty path");
  }
  if (input.length > 1024) {
    throw new PathError("path too long");
  }
  if (input.includes("\0")) {
    throw new PathError("invalid character in path");
  }
  if (input.includes("\\")) {
    throw new PathError("backslashes not allowed in paths");
  }
  if (path.isAbsolute(input)) {
    throw new PathError("absolute paths not allowed");
  }

  const segments = input.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new PathError("path traversal not allowed");
    }
    if (segment.startsWith(".")) {
      throw new PathError("dot-prefixed names not allowed");
    }
  }

  const rel = segments.join("/");
  const root = path.resolve(rootDir);
  const abs = path.resolve(root, rel);
  // belt-and-suspenders: the segment checks above should already guarantee this
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new PathError("path escapes data dir");
  }
  return { rel, abs };
}

/** A drawing file path: everything above, plus the `.excalidraw` extension. */
export function safeFilePath(rootDir: string, input: string) {
  const result = validateRelPath(rootDir, input);
  if (!result.rel.endsWith(FILE_EXT) || result.rel === FILE_EXT) {
    throw new PathError(`only ${FILE_EXT} files are allowed`);
  }
  return result;
}

/** A folder path: same traversal rules, no extension requirement. */
export function safeFolderPath(rootDir: string, input: string) {
  return validateRelPath(rootDir, input);
}
