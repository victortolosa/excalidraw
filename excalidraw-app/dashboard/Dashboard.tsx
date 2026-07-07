import { useCallback, useEffect, useState } from "react";

import { getMeta, toggleFavorite, updateMetaPath } from "../data/serverMeta";

import {
  createFile,
  createFolder,
  deleteFile,
  deleteFolder,
  editorHash,
  listFiles,
  listFolders,
  renameFile,
  thumbnailUrl,
} from "./api";

import { themeClass } from "./theme";

import "./Dashboard.scss";

import type { DashboardMeta } from "../data/serverMeta";
import type { ServerFileEntry, ServerFolderEntry } from "./api";

type SortMode = "mtime" | "name";

const FILE_EXTENSION = ".excalidraw";
const SEARCH_DEBOUNCE_MS = 250;
const MAX_RECENTS_SHOWN = 6;

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

/** display name → file basename; returns null when the name is unusable */
const toFileName = (input: string): string | null => {
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

/** user-typed folder path → normalized path ("" = root); null = invalid */
const toFolderPath = (input: string): string | null => {
  const trimmed = input.trim().replace(/^\/+|\/+$/g, "");
  if (trimmed === "") {
    return "";
  }
  const segments = trimmed.split("/").map((segment) => segment.trim());
  if (
    segments.some(
      (segment) =>
        !segment || segment.startsWith(".") || segment.includes("\\"),
    )
  ) {
    return null;
  }
  return segments.join("/");
};

const NAME_RULES =
  "Please use a plain name (no slashes, not starting with a dot).";

interface FileCardProps {
  file: ServerFileEntry;
  isFavorite: boolean;
  onOpen: (file: ServerFileEntry) => void;
  onToggleFavorite: (file: ServerFileEntry) => void;
  onRename: (file: ServerFileEntry) => void;
  onMove: (file: ServerFileEntry) => void;
  onDelete: (file: ServerFileEntry) => void;
}

const FileCard = ({
  file,
  isFavorite,
  onOpen,
  onToggleFavorite,
  onRename,
  onMove,
  onDelete,
}: FileCardProps) => (
  <div
    className="Dashboard__card"
    onClick={() => onOpen(file)}
    onKeyDown={(event) => {
      if (event.key === "Enter") {
        onOpen(file);
      }
    }}
    role="button"
    tabIndex={0}
  >
    <button
      className={`Dashboard__star ${isFavorite ? "is-active" : ""}`}
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      onClick={(event) => {
        event.stopPropagation();
        onToggleFavorite(file);
      }}
    >
      {isFavorite ? "★" : "☆"}
    </button>
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
        {file.folder && <span>{file.folder} · </span>}
        {formatModified(file.mtime)}
      </div>
    </div>
    <div
      className="Dashboard__card-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <button onClick={() => onRename(file)}>Rename</button>
      <button onClick={() => onMove(file)}>Move</button>
      <button className="Dashboard__danger" onClick={() => onDelete(file)}>
        Delete
      </button>
    </div>
  </div>
);

export const Dashboard = () => {
  const [files, setFiles] = useState<ServerFileEntry[] | null>(null);
  const [folders, setFolders] = useState<ServerFolderEntry[]>([]);
  const [meta, setMeta] = useState<DashboardMeta>({});
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("mtime");
  const [currentFolder, setCurrentFolder] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<ServerFileEntry[] | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const [loadedFiles, loadedFolders, loadedMeta] = await Promise.all([
        listFiles(),
        listFolders(),
        getMeta(),
      ]);
      setFiles(loadedFiles);
      setFolders(loadedFolders);
      setMeta(loadedMeta);
      setError(null);
    } catch (loadError: any) {
      setError(`Could not load drawings: ${loadError.message}`);
    }
  }, []);

  useEffect(() => {
    document.title = "Drawings — Excalidraw";
    refresh();
  }, [refresh]);

  // debounced server-side search (filename + text content)
  useEffect(() => {
    if (!searchInput.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setSearchResults(await listFiles(searchInput));
      } catch {
        setSearchResults([]);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const withErrorHandling = async (operation: () => Promise<void>) => {
    try {
      await operation();
      await refresh();
    } catch (opError: any) {
      window.alert(`Something went wrong: ${opError.message}`);
      await refresh();
    }
  };

  const openFile = (file: ServerFileEntry) => {
    window.location.hash = editorHash(file.path);
  };

  const onToggleFavorite = (file: ServerFileEntry) => {
    withErrorHandling(async () => {
      const favorites = await toggleFavorite(file.path);
      setMeta((current) => ({ ...current, favorites }));
    });
  };

  const onCreate = () => {
    const input = window.prompt("Name for the new drawing:");
    if (input === null) {
      return;
    }
    const name = toFileName(input);
    if (!name) {
      window.alert(NAME_RULES);
      return;
    }
    const path = currentFolder ? `${currentFolder}/${name}` : name;
    if (files?.some((file) => file.path === path)) {
      window.alert(`"${input.trim()}" already exists here.`);
      return;
    }
    withErrorHandling(async () => {
      await createFile(path);
      window.location.hash = editorHash(path);
    });
  };

  const onCreateFolder = () => {
    const input = window.prompt("Name for the new folder:");
    if (input === null) {
      return;
    }
    const name = toFolderPath(input);
    if (!name || name.includes("/")) {
      window.alert(NAME_RULES);
      return;
    }
    const path = currentFolder ? `${currentFolder}/${name}` : name;
    withErrorHandling(() => createFolder(path));
  };

  const onDeleteFolder = (folder: ServerFolderEntry) => {
    if (!window.confirm(`Delete the empty folder "${folder.name}"?`)) {
      return;
    }
    withErrorHandling(() => deleteFolder(folder.path));
  };

  const onRename = (file: ServerFileEntry) => {
    const input = window.prompt("Rename drawing:", file.name);
    if (input === null) {
      return;
    }
    const name = toFileName(input);
    if (!name) {
      window.alert(NAME_RULES);
      return;
    }
    const to = file.folder ? `${file.folder}/${name}` : name;
    if (to === file.path) {
      return;
    }
    withErrorHandling(async () => {
      await renameFile(file.path, to);
      await updateMetaPath(file.path, to);
    });
  };

  const onMove = (file: ServerFileEntry) => {
    const input = window.prompt(
      'Move to folder (empty for the top level, "a/b" for nested):',
      file.folder,
    );
    if (input === null) {
      return;
    }
    const folder = toFolderPath(input);
    if (folder === null) {
      window.alert(NAME_RULES);
      return;
    }
    const name = file.path.split("/").pop()!;
    const to = folder ? `${folder}/${name}` : name;
    if (to === file.path) {
      return;
    }
    withErrorHandling(async () => {
      await renameFile(file.path, to);
      await updateMetaPath(file.path, to);
    });
  };

  const onDelete = (file: ServerFileEntry) => {
    if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) {
      return;
    }
    withErrorHandling(async () => {
      await deleteFile(file.path);
      await updateMetaPath(file.path, null);
    });
  };

  const favorites = meta.favorites ?? [];
  const isSearching = searchResults !== null;

  const byPath = new Map((files ?? []).map((file) => [file.path, file]));
  const favoriteFiles = favorites
    .map((path) => byPath.get(path))
    .filter((file): file is ServerFileEntry => !!file);
  const recentFiles = (meta.recents ?? [])
    .map((path) => byPath.get(path))
    .filter((file): file is ServerFileEntry => !!file)
    .slice(0, MAX_RECENTS_SHOWN);

  const subfolders = folders.filter((folder) => {
    const parent = folder.path.includes("/")
      ? folder.path.slice(0, folder.path.lastIndexOf("/"))
      : "";
    return parent === currentFolder;
  });
  const folderFiles = sortFiles(
    (files ?? []).filter((file) => file.folder === currentFolder),
    sortMode,
  );

  const breadcrumb = currentFolder ? currentFolder.split("/") : [];

  const cardProps = {
    onOpen: openFile,
    onToggleFavorite,
    onRename,
    onMove,
    onDelete,
  };

  const renderGrid = (entries: ServerFileEntry[]) => (
    <div className="Dashboard__grid">
      {entries.map((file) => (
        <FileCard
          key={file.path}
          file={file}
          isFavorite={favorites.includes(file.path)}
          {...cardProps}
        />
      ))}
    </div>
  );

  return (
    <div className={themeClass("Dashboard")}>
      <header className="Dashboard__header">
        <h1>Drawings</h1>
        <div className="Dashboard__controls">
          <input
            className="Dashboard__search"
            type="search"
            placeholder="Search name or contents…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          <select
            aria-label="Sort drawings"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
          >
            <option value="mtime">Last modified</option>
            <option value="name">Name</option>
          </select>
          <button onClick={onCreateFolder}>+ Folder</button>
          <button className="Dashboard__primary" onClick={onCreate}>
            + New drawing
          </button>
        </div>
      </header>

      {error && <div className="Dashboard__error">{error}</div>}

      {isSearching ? (
        <section>
          <h2 className="Dashboard__section-title">
            Results for “{searchInput.trim()}”
          </h2>
          {searchResults.length > 0 ? (
            renderGrid(sortFiles(searchResults, sortMode))
          ) : (
            <div className="Dashboard__empty">No matching drawings.</div>
          )}
        </section>
      ) : (
        <>
          {currentFolder === "" && favoriteFiles.length > 0 && (
            <section>
              <h2 className="Dashboard__section-title">★ Favorites</h2>
              {renderGrid(favoriteFiles)}
            </section>
          )}

          {currentFolder === "" && recentFiles.length > 0 && (
            <section>
              <h2 className="Dashboard__section-title">Recent</h2>
              {renderGrid(recentFiles)}
            </section>
          )}

          <section>
            <div className="Dashboard__breadcrumb">
              <button
                className={currentFolder === "" ? "is-current" : ""}
                onClick={() => setCurrentFolder("")}
              >
                All drawings
              </button>
              {breadcrumb.map((segment, index) => {
                const target = breadcrumb.slice(0, index + 1).join("/");
                return (
                  <span key={target}>
                    {" / "}
                    <button
                      className={target === currentFolder ? "is-current" : ""}
                      onClick={() => setCurrentFolder(target)}
                    >
                      {segment}
                    </button>
                  </span>
                );
              })}
            </div>

            {subfolders.length > 0 && (
              <div className="Dashboard__folders">
                {subfolders.map((folder) => (
                  <div
                    key={folder.path}
                    className="Dashboard__folder"
                    onClick={() => setCurrentFolder(folder.path)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        setCurrentFolder(folder.path);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span>📁 {folder.name}</span>
                    <button
                      className="Dashboard__danger"
                      title="Delete folder (must be empty)"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteFolder(folder);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {files && folderFiles.length === 0 && subfolders.length === 0 && (
              <div className="Dashboard__empty">
                {currentFolder
                  ? "This folder is empty."
                  : "No drawings yet — create your first one."}
              </div>
            )}

            {folderFiles.length > 0 && renderGrid(folderFiles)}
          </section>
        </>
      )}
    </div>
  );
};
