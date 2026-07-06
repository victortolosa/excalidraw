import { useCallback, useEffect, useState } from "react";

import {
  createFile,
  deleteFile,
  editorHash,
  listFiles,
  renameFile,
  thumbnailUrl,
} from "./api";

import "./Dashboard.scss";

import type { ServerFileEntry } from "./api";

type SortMode = "mtime" | "name";

const FILE_EXTENSION = ".excalidraw";

const sortFiles = (files: ServerFileEntry[], mode: SortMode) =>
  [...files].sort((a, b) =>
    mode === "name"
      ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      : b.mtime - a.mtime,
  );

const formatModified = (mtime: number) => {
  const delta = Date.now() - mtime;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 14) {
    return `${days}d ago`;
  }
  return new Date(mtime).toLocaleDateString();
};

/** display name → repo path; returns null when the name is unusable */
const toFilePath = (input: string): string | null => {
  const name = input.trim().replace(/\.excalidraw$/, "");
  if (
    !name ||
    name.includes("/") ||
    name.includes("\\") ||
    name.startsWith(".")
  ) {
    return null;
  }
  return `${name}${FILE_EXTENSION}`;
};

export const Dashboard = () => {
  const [files, setFiles] = useState<ServerFileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("mtime");

  const refresh = useCallback(async () => {
    try {
      setFiles(await listFiles());
      setError(null);
    } catch (loadError: any) {
      setError(`Could not load drawings: ${loadError.message}`);
    }
  }, []);

  useEffect(() => {
    document.title = "Drawings — Excalidraw";
    refresh();
  }, [refresh]);

  const withErrorHandling = async (operation: () => Promise<void>) => {
    try {
      await operation();
      await refresh();
    } catch (opError: any) {
      window.alert(`Something went wrong: ${opError.message}`);
      await refresh();
    }
  };

  const onCreate = () => {
    const input = window.prompt("Name for the new drawing:");
    if (input === null) {
      return;
    }
    const path = toFilePath(input);
    if (!path) {
      window.alert(
        "Please use a plain name (no slashes, not starting with a dot).",
      );
      return;
    }
    if (files?.some((file) => file.path === path)) {
      window.alert(`"${input.trim()}" already exists.`);
      return;
    }
    withErrorHandling(async () => {
      await createFile(path);
      window.location.hash = editorHash(path);
    });
  };

  const onRename = (file: ServerFileEntry) => {
    const input = window.prompt("Rename drawing:", file.name);
    if (input === null) {
      return;
    }
    const targetName = toFilePath(input);
    if (!targetName) {
      window.alert(
        "Please use a plain name (no slashes, not starting with a dot).",
      );
      return;
    }
    // keep the file in its folder — only the basename changes
    const to = file.folder ? `${file.folder}/${targetName}` : targetName;
    if (to === file.path) {
      return;
    }
    withErrorHandling(() => renameFile(file.path, to));
  };

  const onDelete = (file: ServerFileEntry) => {
    if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) {
      return;
    }
    withErrorHandling(() => deleteFile(file.path));
  };

  const openFile = (file: ServerFileEntry) => {
    window.location.hash = editorHash(file.path);
  };

  const sorted = files ? sortFiles(files, sortMode) : null;

  return (
    <div className="Dashboard">
      <header className="Dashboard__header">
        <h1>Drawings</h1>
        <div className="Dashboard__controls">
          <select
            aria-label="Sort drawings"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
          >
            <option value="mtime">Last modified</option>
            <option value="name">Name</option>
          </select>
          <button className="Dashboard__primary" onClick={onCreate}>
            + New drawing
          </button>
        </div>
      </header>

      {error && <div className="Dashboard__error">{error}</div>}

      {sorted && sorted.length === 0 && !error && (
        <div className="Dashboard__empty">
          No drawings yet — create your first one.
        </div>
      )}

      {sorted && sorted.length > 0 && (
        <div className="Dashboard__grid">
          {sorted.map((file) => (
            <div
              key={file.path}
              className="Dashboard__card"
              onClick={() => openFile(file)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  openFile(file);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="Dashboard__thumbnail">
                {file.hasThumbnail ? (
                  <img src={thumbnailUrl(file)} alt="" loading="lazy" />
                ) : (
                  <span className="Dashboard__thumbnail-placeholder">✏️</span>
                )}
              </div>
              <div className="Dashboard__card-meta">
                <div className="Dashboard__card-name" title={file.path}>
                  {file.name}
                </div>
                <div className="Dashboard__card-date">
                  {formatModified(file.mtime)}
                </div>
              </div>
              <div
                className="Dashboard__card-actions"
                onClick={(event) => event.stopPropagation()}
              >
                <button onClick={() => onRename(file)} title="Rename">
                  Rename
                </button>
                <button
                  className="Dashboard__danger"
                  onClick={() => onDelete(file)}
                  title="Delete"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
