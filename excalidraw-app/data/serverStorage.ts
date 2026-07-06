/**
 * Self-hosted dashboard fork: open/save drawings against the file API
 * served from `server/` (see DASHBOARD_PLAN.md).
 *
 * A drawing is "open as a server file" when the URL hash is `#/d/<path>`.
 * In that mode the app-level onChange routes here instead of LocalData,
 * localStorage restore-on-load and tabSync are bypassed, and this module
 * owns its own debounced save + lifecycle flushes.
 */
import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import {
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";

import { atom, appJotaiStore } from "../app-jotai";

const FILE_EXTENSION = ".excalidraw";

const SAVE_DEBOUNCE_MS = 3000;
const SAVE_MAX_WAIT_MS = 15000;
// fetch keepalive payload budget (spec caps in-flight keepalive at 64KiB)
const KEEPALIVE_MAX_BYTES = 60_000;

export type ServerSaveStatus = "dirty" | "saving" | "saved" | "error" | null;

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
}

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
      return { elements: [], files: {} };
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

    return { elements, appState, files, scrollToContent: true };
  } catch (error) {
    console.error(`failed to load server file "${path}"`, error);
    // keep the file "open" so we don't fall back to scratch behavior, but
    // block saves — an empty editor must not overwrite the file on disk
    currentFile = { path, mtime: 0 };
    saveEnabled = false;
    lastSavedScene = null;
    setStatus("error");
    return {
      elements: [],
      appState: {
        errorMessage: `Could not load "${path}" from the server.`,
      },
    };
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
    const response = await fetch(fileUrl(job.path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: serialized,
    });
    if (!response.ok) {
      throw new Error(`save failed: HTTP ${response.status}`);
    }
    const body = await response.json();
    // refresh the conflict baseline so we never conflict with our own write
    if (currentFile?.path === job.path && typeof body.mtime === "number") {
      currentFile.mtime = body.mtime;
    }
    lastSavedScene = serialized;
    setStatus(pending ? "dirty" : "saved");
  } catch (error) {
    console.error(`failed to save server file "${job.path}"`, error);
    // retain the payload — the next change or flush retries
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
  pending = { path: currentFile.path, elements, appState, files };
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
