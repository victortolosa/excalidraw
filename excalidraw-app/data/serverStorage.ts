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

/**
 * the currently open server file; null = scratch mode (stock behavior).
 * `version` is the strong content validator (ETag) this tab last saw from the
 * server — the conflict-guard baseline. null = new/unknown file (no guard).
 */
let currentFile: { path: string; version: string | null } | null = null;
/** guards against clobbering a file we failed to load */
let saveEnabled = false;
/** serialized scene as of the last successful save (skip-if-unchanged) */
let lastSavedScene: string | null = null;

interface PendingSave {
  /** monotonic client revision — identifies this exact snapshot */
  revision: number;
  path: string;
  elements: readonly OrderedExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
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

/** newest snapshot awaiting durability; superseded in place by later edits */
let pending: PendingSave | null = null;
let nextRevision = 1;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let firstQueuedAt: number | null = null;
/** the single in-flight drain loop, shared by every flush caller */
let saveLoop: Promise<void> | null = null;

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
  // drop any leftover queue so a stray retry can't write to the file we left
  clearDebounce();
  pending = null;
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
      currentFile = { path, version: null };
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

    // strong content validator for the conflict guard; falls back to null
    // (unconditional first save) if the server didn't send one
    const version = response.headers.get("ETag");
    // non-JSON here usually means an auth wall (e.g. Cloudflare Access
    // login page) — surface as an error rather than rendering garbage
    const data = JSON.parse(await response.text());

    const elements = restoreElements(data.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    });
    const appState = restoreAppState(data.appState, null);
    const files: BinaryFiles = data.files ?? {};

    currentFile = { path, version };
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
    currentFile = { path, version: null };
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

const putScene = (
  path: string,
  serialized: string,
  baseVersion: string | null,
) =>
  fetch(fileUrl(path), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      // no baseline = new file or a deliberate post-conflict overwrite
      ...(baseVersion ? { "X-Base-Version": baseVersion } : {}),
    },
    body: serialized,
  });

/**
 * Drain the pending queue until it is clean or hits a state that can't be
 * retried right now (auth wall, reload, network error). Runs as a single
 * shared loop — see `drain()`; every flush caller awaits the same promise, so
 * a save can never be stranded behind a background timer.
 *
 * Each iteration re-reads `pending`, so an edit that lands mid-request is
 * picked up automatically on the next turn. The conflict baseline is resolved
 * at send time (not when the edit was queued) and refreshed from each server
 * ack before the next revision goes out.
 */
const runDrain = async () => {
  while (pending) {
    const job = pending;
    const serialized = serializeAsJSON(
      job.elements,
      job.appState,
      job.files,
      "local",
    );

    // onChange also fires on selection/viewport changes — never PUT a
    // byte-identical scene. Already durable, so drop it (unless a newer
    // revision superseded it while we were computing).
    if (serialized === lastSavedScene) {
      if (pending.revision === job.revision) {
        pending = null;
      }
      setStatus(pending ? "dirty" : "saved");
      continue;
    }

    setStatus("saving");
    // baseline resolved now, from the newest ack — not stale queue-time state
    const baseVersion =
      currentFile?.path === job.path ? currentFile.version : null;

    try {
      let response = await putScene(job.path, serialized, baseVersion);

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
        response = await putScene(job.path, serialized, null);
      }

      if (looksLikeAuthWall(response)) {
        writeRecovery(job.path, serialized);
        setStatus("session-expired");
        return; // keep `pending`; a later trigger retries
      }
      if (!response.ok) {
        throw new Error(`save failed: HTTP ${response.status}`);
      }

      const body = await response.json().catch(() => ({}));
      // refresh the baseline before the next queued revision goes out, so we
      // never conflict with our own write
      if (currentFile?.path === job.path && typeof body.version === "string") {
        currentFile.version = body.version;
      }
      lastSavedScene = serialized;
      clearRecovery(job.path);
      // only clear the queue if no newer edit arrived while we were saving
      if (pending.revision === job.revision) {
        pending = null;
      }
      setStatus(pending ? "dirty" : "saved");
      putThumbnail(job);
    } catch (error) {
      console.error(`failed to save server file "${job.path}"`, error);
      // retain the payload — a later trigger retries, and the localStorage
      // copy survives a tab close
      writeRecovery(job.path, serialized);
      setStatus("error");
      return; // keep `pending`; stop looping so we don't hammer a dead server
    }
  }
};

/**
 * Start the drain loop, or join the one already running. Returns a promise
 * that resolves when the loop stops (queue clean, or a non-retryable state).
 */
const drain = (): Promise<void> => {
  if (!saveLoop) {
    saveLoop = runDrain().finally(() => {
      saveLoop = null;
    });
  }
  return saveLoop;
};

const clearDebounce = () => {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  firstQueuedAt = null;
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
    firstQueuedAt = null;
    void drain();
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
  // supersede any older queued snapshot in place; the newest wins
  pending = {
    revision: nextRevision++,
    path: currentFile.path,
    elements,
    appState,
    files,
  };
  setStatus("dirty");
  scheduleSave();
};

/**
 * Persist any pending change immediately, then wait until the queue is clean.
 * Awaits the in-flight request too, so a revision can never be stranded behind
 * the debounce timer once this resolves (lifecycle boundaries rely on that).
 */
export const flushServerSave = async () => {
  clearDebounce();
  await drain();
};

/**
 * Best-effort synchronous-ish flush for pagehide/unload, where awaiting a
 * normal fetch isn't possible. Unlike a background drain this still sends the
 * conflict baseline, so a stale exit write is rejected rather than silently
 * clobbering newer work. keepalive only fits small payloads; larger scenes
 * fall back to a regular fetch the browser may cancel — the visibilitychange
 * flush above makes this a rare last resort.
 */
const flushOnExit = () => {
  if (!pending) {
    return;
  }
  const job = pending;
  const serialized = serializeAsJSON(
    job.elements,
    job.appState,
    job.files,
    "local",
  );
  if (serialized === lastSavedScene) {
    return;
  }
  const baseVersion =
    currentFile?.path === job.path ? currentFile.version : null;
  fetch(fileUrl(job.path), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(baseVersion ? { "X-Base-Version": baseVersion } : {}),
    },
    body: serialized,
    keepalive: serialized.length < KEEPALIVE_MAX_BYTES,
  }).catch(() => {});
};

if (typeof window !== "undefined") {
  // hidden = the last reliable moment to persist before a close/discard
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      void flushServerSave();
    }
  });
  // coming back / restored from bfcache — retry anything left queued
  window.addEventListener("focus", () => {
    void drain();
  });
  window.addEventListener("pageshow", () => {
    void drain();
  });
  window.addEventListener("pagehide", flushOnExit);
  // route changes: flush the outgoing file (pending carries its own path);
  // when leaving server mode entirely, restore stock behavior
  window.addEventListener("hashchange", () => {
    void flushServerSave();
    if (!parseServerHash(window.location.hash)) {
      closeServerFile();
    }
  });
}
