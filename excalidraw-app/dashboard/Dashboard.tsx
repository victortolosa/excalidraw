import { useCallback, useEffect, useRef, useState } from "react";

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

import type { DragEvent } from "react";
import type { DashboardMeta } from "../data/serverMeta";
import type { ServerFileEntry, ServerFolderEntry } from "./api";

type SortMode = "mtime" | "name";
type QuickAccessTab = "favorites" | "recent";
type IconName =
  | "folder"
  | "grid"
  | "more"
  | "pen"
  | "plus"
  | "search"
  | "star"
  | "trash";

const FILE_EXTENSION = ".excalidraw";
const FILE_DRAG_MIME = "application/x-excalidraw-dashboard-file";
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

const pathForFolder = (file: ServerFileEntry, folder: string) => {
  const name = file.path.split("/").pop()!;
  return folder ? `${folder}/${name}` : name;
};

const Icon = ({ name }: { name: IconName }) => {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      {name === "folder" && (
        <path
          {...common}
          d="M3.8 6.5h6l2 2h8.4v8.8a2.2 2.2 0 0 1-2.2 2.2H6a2.2 2.2 0 0 1-2.2-2.2Z"
        />
      )}
      {name === "grid" && (
        <>
          <path
            {...common}
            d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"
          />
        </>
      )}
      {name === "more" && (
        <>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" />
        </>
      )}
      {name === "pen" && (
        <path
          {...common}
          d="m4 20 4.8-1.1L19.3 8.4a2.1 2.1 0 0 0-3-3L5.9 15.9Z"
        />
      )}
      {name === "plus" && <path {...common} d="M12 5v14M5 12h14" />}
      {name === "search" && (
        <path
          {...common}
          d="m20 20-4.2-4.2M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z"
        />
      )}
      {name === "star" && (
        <path
          {...common}
          d="m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.5-5-2.6-5 2.6.9-5.5-4-3.9 5.6-.8Z"
        />
      )}
      {name === "trash" && (
        <path
          {...common}
          d="M5 7h14M10 11v6M14 11v6M8 7l.7 12h6.6L16 7M9.5 7l.6-2h3.8l.6 2"
        />
      )}
    </svg>
  );
};

interface FileCardProps {
  file: ServerFileEntry;
  isFavorite: boolean;
  isDragging: boolean;
  menuOpen: boolean;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLElement>, file: ServerFileEntry) => void;
  onOpen: (file: ServerFileEntry) => void;
  onToggleFavorite: (file: ServerFileEntry) => void;
  onRename: (file: ServerFileEntry) => void;
  onMove: (file: ServerFileEntry) => void;
  onDelete: (file: ServerFileEntry) => void;
  onMenuToggle: (path: string) => void;
}

const Thumbnail = ({ file }: { file: ServerFileEntry }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [file.hasThumbnail, file.mtime, file.path]);

  if (file.hasThumbnail && !failed) {
    return (
      <img
        src={thumbnailUrl(file)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className="Dashboard__thumbnail-placeholder">
      <Icon name="pen" />
    </span>
  );
};

const FileCard = ({
  file,
  isFavorite,
  isDragging,
  menuOpen,
  onDragEnd,
  onDragStart,
  onOpen,
  onToggleFavorite,
  onRename,
  onMove,
  onDelete,
  onMenuToggle,
}: FileCardProps) => (
  <article
    className={`Dashboard__card ${isDragging ? "is-dragging" : ""}`}
    draggable
    onClick={() => onOpen(file)}
    onDragEnd={onDragEnd}
    onDragStart={(event) => onDragStart(event, file)}
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
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      onClick={(event) => {
        event.stopPropagation();
        onToggleFavorite(file);
      }}
    >
      <Icon name="star" />
    </button>
    <div className="Dashboard__thumbnail">
      <Thumbnail file={file} />
    </div>
    <div className="Dashboard__card-body">
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
        <button
          aria-expanded={menuOpen}
          aria-label={`Actions for ${file.name}`}
          className="Dashboard__icon-button"
          onClick={() => onMenuToggle(file.path)}
        >
          <Icon name="more" />
        </button>
        {menuOpen && (
          <div className="Dashboard__menu" role="menu">
            <button role="menuitem" onClick={() => onRename(file)}>
              Rename
            </button>
            <button role="menuitem" onClick={() => onMove(file)}>
              Move
            </button>
            <button
              className="Dashboard__danger"
              role="menuitem"
              onClick={() => onDelete(file)}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  </article>
);

const filePathFromDrag = (event: DragEvent<HTMLElement>) =>
  (() => {
    try {
      return (
        event.dataTransfer.getData(FILE_DRAG_MIME) ||
        event.dataTransfer.getData("text/plain")
      );
    } catch {
      return "";
    }
  })();

export const Dashboard = () => {
  const [files, setFiles] = useState<ServerFileEntry[] | null>(null);
  const [folders, setFolders] = useState<ServerFolderEntry[]>([]);
  const [meta, setMeta] = useState<DashboardMeta>({});
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("mtime");
  const [quickAccessTab, setQuickAccessTab] =
    useState<QuickAccessTab>("favorites");
  const [currentFolder, setCurrentFolder] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<ServerFileEntry[] | null>(
    null,
  );
  const [openMenuPath, setOpenMenuPath] = useState<string | null>(null);
  const [draggedFilePath, setDraggedFilePath] = useState<string | null>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);
  const suppressNextOpenRef = useRef(false);

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

  useEffect(() => {
    const onWindowClick = () => setOpenMenuPath(null);
    window.addEventListener("click", onWindowClick);
    return () => window.removeEventListener("click", onWindowClick);
  }, []);

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
    if (suppressNextOpenRef.current) {
      suppressNextOpenRef.current = false;
      return;
    }
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
    if (files?.some((entry) => entry.path === to && entry.path !== file.path)) {
      const destination = file.folder || "All drawings";
      window.alert(`"${name}" already exists in ${destination}.`);
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
    const to = pathForFolder(file, folder);
    if (to === file.path) {
      return;
    }
    if (files?.some((entry) => entry.path === to && entry.path !== file.path)) {
      const destination = folder || "All drawings";
      window.alert(`"${file.name}" already exists in ${destination}.`);
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

  const moveFileToFolder = useCallback(
    async (file: ServerFileEntry, folder: string) => {
      const to = pathForFolder(file, folder);
      if (to === file.path) {
        return;
      }
      if (
        files?.some((entry) => entry.path === to && entry.path !== file.path)
      ) {
        const destination = folder || "All drawings";
        throw new Error(`"${file.name}" already exists in ${destination}.`);
      }
      await renameFile(file.path, to);
      await updateMetaPath(file.path, to);
    },
    [files],
  );

  const onFileDragStart = (
    event: DragEvent<HTMLElement>,
    file: ServerFileEntry,
  ) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button, a")
    ) {
      event.preventDefault();
      return;
    }
    suppressNextOpenRef.current = true;
    try {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(FILE_DRAG_MIME, file.path);
      event.dataTransfer.setData("text/plain", file.path);
    } catch {
      // Some embedded browsers expose partial DataTransfer implementations.
    }
    setDraggedFilePath(file.path);
    setDropTargetFolder(null);
    setOpenMenuPath(null);
  };

  const onFileDragEnd = () => {
    setDraggedFilePath(null);
    setDropTargetFolder(null);
    window.setTimeout(() => {
      suppressNextOpenRef.current = false;
    }, 0);
  };

  const getDropTargetProps = (folder: string) => {
    const canDrop = () => {
      const dragged = draggedFilePath ? byPath.get(draggedFilePath) : null;
      if (!dragged || dragged.folder === folder) {
        return false;
      }
      const to = pathForFolder(dragged, folder);
      return !files?.some(
        (entry) => entry.path === to && entry.path !== dragged.path,
      );
    };

    return {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (!canDrop()) {
          return;
        }
        event.preventDefault();
        setDropTargetFolder(folder);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        const relatedTarget = event.relatedTarget;
        if (
          relatedTarget instanceof Node &&
          event.currentTarget.contains(relatedTarget)
        ) {
          return;
        }
        setDropTargetFolder((current) => (current === folder ? null : current));
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!canDrop()) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTargetFolder(folder);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const path = filePathFromDrag(event) || draggedFilePath;
        const file = path ? byPath.get(path) : null;
        setDraggedFilePath(null);
        setDropTargetFolder(null);
        window.setTimeout(() => {
          suppressNextOpenRef.current = false;
        }, 0);
        if (!file || file.folder === folder) {
          return;
        }
        withErrorHandling(() => moveFileToFolder(file, folder));
      },
    };
  };

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
  const quickAccessFiles =
    quickAccessTab === "favorites" ? favoriteFiles : recentFiles;
  const hasQuickAccess = favoriteFiles.length > 0 || recentFiles.length > 0;

  const breadcrumb = currentFolder ? currentFolder.split("/") : [];

  const cardProps = {
    onOpen: openFile,
    onToggleFavorite,
    onRename,
    onMove,
    onDelete,
    onMenuToggle: (path: string) =>
      setOpenMenuPath((current) => (current === path ? null : path)),
    onDragEnd: onFileDragEnd,
    onDragStart: onFileDragStart,
  };

  const renderGrid = (entries: ServerFileEntry[], variant = "") => (
    <div className={`Dashboard__grid ${variant}`}>
      {entries.map((file) => (
        <FileCard
          key={file.path}
          file={file}
          isDragging={draggedFilePath === file.path}
          isFavorite={favorites.includes(file.path)}
          menuOpen={openMenuPath === file.path}
          {...cardProps}
        />
      ))}
    </div>
  );

  return (
    <div className={themeClass("Dashboard")}>
      <div className="Dashboard__shell">
        <header className="Dashboard__header">
          <div className="Dashboard__title-block">
            <h1>Drawings</h1>
          </div>
          <div className="Dashboard__actions">
            <button className="Dashboard__secondary" onClick={onCreateFolder}>
              <Icon name="folder" />
              Folder
            </button>
            <button className="Dashboard__primary" onClick={onCreate}>
              <Icon name="plus" />
              New drawing
            </button>
            <a
              className="Dashboard__scratch-link"
              href="#scratch"
              title="Open the stock scratch editor (browser-local, not saved to the server)"
            >
              Scratchpad
            </a>
          </div>
        </header>

        <div className="Dashboard__toolbar">
          <label className="Dashboard__search">
            <Icon name="search" />
            <input
              aria-label="Search drawings by name or contents"
              type="search"
              placeholder="Search drawings, folders, or text inside files"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
          <div className="Dashboard__toolbar-actions">
            <select
              aria-label="Sort drawings"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
            >
              <option value="mtime">Last modified</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        {error && <div className="Dashboard__error">{error}</div>}

        {isSearching ? (
          <section className="Dashboard__section">
            <div className="Dashboard__section-header">
              <div>
                <h2>Search results</h2>
                <p>
                  {searchResults.length} matches for "{searchInput.trim()}"
                </p>
              </div>
            </div>
            {searchResults.length > 0 ? (
              renderGrid(sortFiles(searchResults, sortMode))
            ) : (
              <div className="Dashboard__empty">No matching drawings.</div>
            )}
          </section>
        ) : (
          <>
            {currentFolder === "" && hasQuickAccess && (
              <section className="Dashboard__section">
                <div className="Dashboard__section-header">
                  <div>
                    <h2>Quick access</h2>
                    <p>
                      {quickAccessTab === "favorites"
                        ? `${favoriteFiles.length} favorite drawings`
                        : `${recentFiles.length} recently opened drawings`}
                    </p>
                  </div>
                  <div className="Dashboard__tabs" role="tablist">
                    <button
                      aria-selected={quickAccessTab === "favorites"}
                      className={
                        quickAccessTab === "favorites" ? "is-active" : ""
                      }
                      onClick={() => setQuickAccessTab("favorites")}
                      role="tab"
                    >
                      Favorites
                    </button>
                    <button
                      aria-selected={quickAccessTab === "recent"}
                      className={quickAccessTab === "recent" ? "is-active" : ""}
                      onClick={() => setQuickAccessTab("recent")}
                      role="tab"
                    >
                      Recent
                    </button>
                  </div>
                </div>
                {quickAccessFiles.length > 0 ? (
                  renderGrid(quickAccessFiles, "Dashboard__grid--compact")
                ) : (
                  <div className="Dashboard__empty Dashboard__empty--compact">
                    {quickAccessTab === "favorites"
                      ? "No favorites yet."
                      : "No recent drawings yet."}
                  </div>
                )}
              </section>
            )}

            <section className="Dashboard__section">
              <div className="Dashboard__section-header Dashboard__section-header--library">
                <div>
                  <h2>
                    {currentFolder ? currentFolder.split("/").pop() : "Library"}
                  </h2>
                  <p>
                    {folderFiles.length} drawings
                    {subfolders.length > 0 && ` · ${subfolders.length} folders`}
                  </p>
                </div>
                <div className="Dashboard__breadcrumb">
                  <button
                    className={`${currentFolder === "" ? "is-current" : ""} ${
                      dropTargetFolder === "" ? "is-drop-target" : ""
                    }`}
                    onClick={() => setCurrentFolder("")}
                    {...getDropTargetProps("")}
                  >
                    All drawings
                  </button>
                  {breadcrumb.map((segment, index) => {
                    const target = breadcrumb.slice(0, index + 1).join("/");
                    return (
                      <span key={target}>
                        /
                        <button
                          className={`${
                            target === currentFolder ? "is-current" : ""
                          } ${
                            dropTargetFolder === target ? "is-drop-target" : ""
                          }`}
                          onClick={() => setCurrentFolder(target)}
                          {...getDropTargetProps(target)}
                        >
                          {segment}
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>

              {subfolders.length > 0 && (
                <div className="Dashboard__folders">
                  {subfolders.map((folder) => (
                    <div
                      key={folder.path}
                      className={`Dashboard__folder ${
                        dropTargetFolder === folder.path ? "is-drop-target" : ""
                      }`}
                      onClick={() => setCurrentFolder(folder.path)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          setCurrentFolder(folder.path);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      {...getDropTargetProps(folder.path)}
                    >
                      <span>
                        <Icon name="folder" />
                        {folder.name}
                      </span>
                      <button
                        className="Dashboard__danger"
                        title="Delete folder (must be empty)"
                        aria-label={`Delete folder ${folder.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteFolder(folder);
                        }}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {files && folderFiles.length === 0 && subfolders.length === 0 && (
                <div className="Dashboard__empty">
                  <Icon name="grid" />
                  {currentFolder
                    ? "This folder is empty."
                    : "No drawings yet. Create your first one."}
                </div>
              )}

              {folderFiles.length > 0 && renderGrid(folderFiles)}
            </section>
          </>
        )}
      </div>
    </div>
  );
};
