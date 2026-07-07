/**
 * Self-hosted dashboard fork: open/save drawings against the file API
 * served from `server/` (see DASHBOARD_PLAN.md).
 *
 * A drawing is "open as a server file" when the URL hash is `#/d/<path>`.
 * In that mode the app-level onChange routes here instead of LocalData,
 * localStorage restore-on-load and tabSync are bypassed, and this module
 * owns its own debounced save + lifecycle flushes.
 */
import { isTestEnv } from "@excalidraw/common";
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import {
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { exportToSvg } from "@excalidraw/excalidraw/scene/export";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

import { atom, appJotaiStore } from "../app-jotai";

import { recordRecent } from "./serverMeta";

const FILE_EXTENSION = ".excalidraw";

const SAVE_DEBOUNCE_MS = 3000;
const SAVE_MAX_WAIT_MS = 15000;
// fetch keepalive payload budget (spec caps in-flight keepalive at 64KiB)
const KEEPALIVE_MAX_BYTES = 60_000;

export type ServerSaveStatus =
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "session-expired"
  | null;

export const serverSaveStatusAtom = atom<ServerSaveStatus>(null);

const setStatus = (status: ServerSaveStatus) => {
  appJotaiStore.set(serverSaveStatusAtom, status);
};

/** the currently open server file; null = scratch mode (stock behavior) */
let currentFile: { path: string; mtime: number } | null = null;
/** guards against clobbering a file we failed to load */
let saveEnabled = false;
/** serialized scene as of the last successful save (skip-if-unchanged) */
let lastSavedScene: string | null = null;

interface PendingSave {
  path: string;
  elements: readonly OrderedExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
  /** server mtime this tab last saw — the conflict-guard baseline */
  baseline: number;
}

// ---------------------------------------------------------------------------
// crash/offline recovery: failed saves are kept in localStorage until a PUT
// for that path succeeds, so closing the tab while the server is down (or a
// Cloudflare Access session expired) doesn't lose work
// ---------------------------------------------------------------------------

const RECOVERY_PREFIX = "excalidraw-server-recovery:";

const writeRecovery = (path: string, serialized: string) => {
  try {
    localStorage.setItem(RECOVERY_PREFIX + path, serialized);
  } catch {
    // quota exceeded — nothing we can do
  }
};

const readRecovery = (path: string) => {
  try {
    return localStorage.getItem(RECOVERY_PREFIX + path);
  } catch {
    return null;
  }
};

const clearRecovery = (path: string) => {
  try {
    localStorage.removeItem(RECOVERY_PREFIX + path);
  } catch {
    // ignore
  }
};

/** a Cloudflare Access login page instead of JSON = expired session */
const looksLikeAuthWall = (response: Response) =>
  (response.headers.get("Content-Type") ?? "").includes("text/html");

let pending: PendingSave | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let firstQueuedAt: number | null = null;
let saveInFlight = false;

const encodePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

const fileUrl = (path: string) => `/api/files/${encodePath(path)}`;

/** `#/d/<path>` → path, else null */
export const parseServerHash = (hash: string): string | null => {
  const match = hash.match(/^#\/d\/(.+)$/);
  if (!match) {
    return null;
  }
  try {
    const path = decodeURIComponent(match[1]);
    return path.endsWith(FILE_EXTENSION) ? path : null;
  } catch {
    return null;
  }
};

export const isServerFileOpen = () => currentFile !== null;

export const getOpenServerFile = () => currentFile?.path ?? null;

const closeServerFile = () => {
  currentFile = null;
  saveEnabled = false;
  lastSavedScene = null;
  setStatus(null);
};

/**
 * If a recovery copy exists for `path` and the user wants it, return the
 * restored scene (and queue a save of it); otherwise clean up and return
 * null so the server copy is used.
 */
const restoreFromRecovery = (path: string, serverSerialized: string | null) => {
  const recovered = readRecovery(path);
  if (!recovered || recovered === serverSerialized) {
    clearRecovery(path);
    return null;
  }
  if (
    !window.confirm(
      `Found unsaved local changes for "${path}" from a previous session.\n\n` +
        `OK — restore them (they'll be saved to the server).\n` +
        `Cancel — discard them and use the server version.`,
    )
  ) {
    clearRecovery(path);
    return null;
  }
  try {
    const data = JSON.parse(recovered);
    const elements = restoreElements(data.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    });
    // RestoredAppState is a serializable subset of AppState — the save
    // path only ever serializes it, so the wider type is safe here
    const appState = restoreAppState(data.appState, null) as AppState;
    const files: BinaryFiles = data.files ?? {};
    return { elements, appState, files };
  } catch {
    clearRecovery(path);
    return null;
  }
};

/**
 * Load a drawing from the server. Called from App's initializeScene when
 * the hash is `#/d/<path>` — the returned scene replaces any localStorage
 * restore (scratch content must never bleed into a server file).
 */
export const loadServerScene = async (
  path: string,
): Promise<ExcalidrawInitialDataState> => {
  // switching files? persist the previous one first
  await flushServerSave();

  try {
    const response = await fetch(fileUrl(path));

    if (response.status === 404) {
      // treat as a new drawing: first save creates it
      currentFile = { path, mtime: 0 };
      saveEnabled = true;
      lastSavedScene = null;
      setStatus("saved");
      const recovered = restoreFromRecovery(path, null);
      if (recovered) {
        saveToServer(recovered.elements, recovered.appState, recovered.files);
        return { ...recovered, scrollToContent: true };
      }
      return { elements: [], files: {} };
    }
    if (looksLikeAuthWall(response)) {
      throw new Error("session expired (auth wall instead of JSON)");
    }
    if (!response.ok) {
      throw new Error(`load failed: HTTP ${response.status}`);
    }

    const mtime = Number(response.headers.get("X-Mtime")) || 0;
    // non-JSON here usually means an auth wall (e.g. Cloudflare Access
    // login page) — surface as an error rather than rendering garbage
    const data = JSON.parse(await response.text());

    const elements = restoreElements(data.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    });
    const appState = restoreAppState(data.appState, null);
    const files: BinaryFiles = data.files ?? {};

    currentFile = { path, mtime };
    saveEnabled = true;
    lastSavedScene = serializeAsJSON(elements, appState, files, "local");
    setStatus("saved");
    if (!isTestEnv()) {
      recordRecent(path).catch(() => {});
    }

    const recovered = restoreFromRecovery(path, lastSavedScene);
    if (recovered) {
      saveToServer(recovered.elements, recovered.appState, recovered.files);
      return { ...recovered, scrollToContent: true };
    }

    return { elements, appState, files, scrollToContent: true };
  } catch (error: any) {
    console.error(`failed to load server file "${path}"`, error);
    // keep the file "open" so we don't fall back to scratch behavior, but
    // block saves — an empty editor must not overwrite the file on disk
    currentFile = { path, mtime: 0 };
    saveEnabled = false;
    lastSavedScene = null;
    const sessionExpired = String(error?.message).includes("session expired");
    setStatus(sessionExpired ? "session-expired" : "error");
    return {
      elements: [],
      appState: {
        errorMessage: sessionExpired
          ? "Your session expired — reload the page to sign in again."
          : `Could not load "${path}" from the server.`,
      },
    };
  }
};

/**
 * Regenerate the dashboard thumbnail after a successful save. Fire and
 * forget — a missing thumbnail only degrades the dashboard grid.
 */
const putThumbnail = async (job: PendingSave) => {
  if (isTestEnv()) {
    return;
  }
  try {
    const elements = job.elements.filter((element) => !element.isDeleted);
    if (!elements.length) {
      return;
    }
    const svg = await exportToSvg(
      elements,
      {
        exportBackground: true,
        viewBackgroundColor: job.appState.viewBackgroundColor ?? "#ffffff",
        exportPadding: 16,
      },
      job.files,
    );
    await fetch(`${fileUrl(job.path)}/thumbnail`, {
      method: "PUT",
      headers: { "Content-Type": "image/svg+xml" },
      body: svg.outerHTML,
    });
  } catch (error) {
    console.warn(`thumbnail generation failed for "${job.path}"`, error);
  }
};

const performSave = async () => {
  if (!pending || saveInFlight) {
    return;
  }
  const job = pending;
  pending = null;
  firstQueuedAt = null;

  const serialized = serializeAsJSON(
    job.elements,
    job.appState,
    job.files,
    "local",
  );
  // onChange also fires on selection/viewport changes — never PUT a
  // byte-identical scene
  if (serialized === lastSavedScene) {
    setStatus("saved");
    return;
  }

  saveInFlight = true;
  setStatus("saving");
  try {
    const putScene = (baseline: number) =>
      fetch(fileUrl(job.path), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          // baseline 0 = new file or deliberate overwrite — no guard
          ...(baseline > 0 ? { "X-Base-Mtime": String(baseline) } : {}),
        },
        body: serialized,
      });

    let response = await putScene(job.baseline);

    if (response.status === 409) {
      const overwrite = window.confirm(
        `"${job.path}" changed on the server (another tab or device?).\n\n` +
          `OK — overwrite it with this tab's version.\n` +
          `Cancel — reload to get the server version (this tab's latest ` +
          `changes are kept locally as a backup).`,
      );
      if (!overwrite) {
        writeRecovery(job.path, serialized);
        window.location.reload();
        return;
      }
      response = await putScene(0);
    }

    if (looksLikeAuthWall(response)) {
      writeRecovery(job.path, serialized);
      pending = pending ?? job;
      setStatus("session-expired");
      return;
    }
    if (!response.ok) {
      throw new Error(`save failed: HTTP ${response.status}`);
    }
    const body = await response.json();
    // refresh the conflict baseline so we never conflict with our own write
    if (currentFile?.path === job.path && typeof body.mtime === "number") {
      currentFile.mtime = body.mtime;
    }
    lastSavedScene = serialized;
    clearRecovery(job.path);
    setStatus(pending ? "dirty" : "saved");
    putThumbnail(job);
  } catch (error) {
    console.error(`failed to save server file "${job.path}"`, error);
    // retain the payload — the next change or flush retries, and the
    // localStorage copy survives a tab close
    writeRecovery(job.path, serialized);
    pending = pending ?? job;
    setStatus("error");
  } finally {
    saveInFlight = false;
    if (pending) {
      scheduleSave();
    }
  }
};

const scheduleSave = () => {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  const now = Date.now();
  firstQueuedAt = firstQueuedAt ?? now;
  const elapsed = now - firstQueuedAt;
  const wait = Math.max(
    0,
    Math.min(SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS - elapsed),
  );
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    performSave();
  }, wait);
};

/**
 * Queue a debounced save of the full scene. Called from the app-level
 * onChange when a server file is open (instead of LocalData.save).
 */
export const saveToServer = (
  elements: readonly OrderedExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
) => {
  if (!currentFile || !saveEnabled) {
    return;
  }
  pending = {
    path: currentFile.path,
    elements,
    appState,
    files,
    baseline: currentFile.mtime,
  };
  setStatus("dirty");
  scheduleSave();
};

/** Persist any pending change immediately (lifecycle boundaries). */
export const flushServerSave = async () => {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  await performSave();
};

/**
 * Best-effort synchronous-ish flush for pagehide/unload, where awaiting a
 * normal fetch isn't possible. keepalive only fits small payloads; larger
 * scenes fall back to a regular fetch the browser may cancel — the
 * visibilitychange flush below makes this a rare last resort.
 */
const flushOnExit = () => {
  if (!pending) {
    return;
  }
  const job = pending;
  pending = null;
  const serialized = serializeAsJSON(
    job.elements,
    job.appState,
    job.files,
    "local",
  );
  if (serialized === lastSavedScene) {
    return;
  }
  fetch(fileUrl(job.path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: serialized,
    keepalive: serialized.length < KEEPALIVE_MAX_BYTES,
  }).catch(() => {});
};

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      flushServerSave();
    }
  });
  window.addEventListener("blur", () => {
    flushServerSave();
  });
  window.addEventListener("pagehide", flushOnExit);
  // route changes: flush the outgoing file (pending carries its own path);
  // when leaving server mode entirely, restore stock behavior
  window.addEventListener("hashchange", () => {
    flushServerSave();
    if (!parseServerHash(window.location.hash)) {
      closeServerFile();
    }
  });
}
