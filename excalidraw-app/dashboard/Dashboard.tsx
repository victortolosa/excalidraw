import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@prism-local/react/alert";
import { Button } from "@prism-local/react/button";
import { Dialog } from "@prism-local/react/dialog";
import { DropdownMenu } from "@prism-local/react/dropdown-menu";
import { Empty } from "@prism-local/react/empty";
import { Page } from "@prism-local/react/page";
import { SearchField } from "@prism-local/react/search-field";
import { Section } from "@prism-local/react/section";
import { Select } from "@prism-local/react/select";
import { Tabs } from "@prism-local/react/tabs";
import { Toggle } from "@prism-local/react/toggle";
import { ToastProvider, useToast } from "@prism-local/react/toast";
import { TextField } from "@prism-local/react/text-field";

import { STORAGE_KEYS } from "../app_constants";

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

import prismStyles from "./Prism.css?inline";
import { isDarkTheme } from "./theme";

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

const formatFileSize = (size: number) => {
  if (!Number.isFinite(size) || size < 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const formattedValue =
    unitIndex === 0 || value >= 10 ? Math.round(value) : value.toFixed(1);

  return `${formattedValue} ${units[unitIndex]}`;
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
  pending: boolean;
  onNavigate: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLElement>, file: ServerFileEntry) => void;
  onToggleFavorite: (file: ServerFileEntry) => void;
  onAction: (
    action: string,
    file: ServerFileEntry,
    trigger: HTMLButtonElement | null,
  ) => void;
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
  pending,
  onNavigate,
  onDragEnd,
  onDragStart,
  onToggleFavorite,
  onAction,
}: FileCardProps) => (
  <article
    className={`Dashboard__card overflow-hidden rounded-panel border bg-card text-card-foreground ${
      isDragging ? "opacity-50" : ""
    }`}
    draggable
    onDragEnd={onDragEnd}
    onDragStart={(event) => onDragStart(event, file)}
  >
    <a
      href={editorHash(file.path)}
      draggable={false}
      onClick={onNavigate}
      className="Dashboard__thumbnail block bg-muted"
      aria-label={`Open ${file.name}`}
    >
      <Thumbnail file={file} />
    </a>
    <div className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0 space-y-2">
        <h3 className="font-heading text-base font-semibold">
          <a
            href={editorHash(file.path)}
            draggable={false}
            onClick={onNavigate}
          >
            {file.name}
          </a>
        </h3>
        <p className="text-xs text-muted-foreground">
          {[file.folder, formatFileSize(file.size), formatModified(file.mtime)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Toggle
          label={`Favorite ${file.name}`}
          icon="star"
          pressed={isFavorite}
          pending={pending}
          onPressedChange={() => onToggleFavorite(file)}
        />
        <DropdownMenu
          trigger="icon"
          label={`Actions for ${file.name}`}
          items={[
            { id: "rename", label: "Rename" },
            { id: "move", label: "Move" },
            { id: "delete", label: "Delete", variant: "destructive" },
          ]}
          onAction={(action, trigger) => onAction(action, file, trigger)}
        />
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

type Task = {
  kind: "create" | "folder" | "rename" | "move" | "delete" | "deleteFolder";
  file?: ServerFileEntry;
  folder?: ServerFolderEntry;
};

const DashboardContent = () => {
  const toast = useToast();
  const [darkTheme, setDarkTheme] = useState(isDarkTheme);
  const [task, setTask] = useState<Task | null>(null);
  const [taskValue, setTaskValue] = useState("");
  const [customDestination, setCustomDestination] = useState(false);
  const [taskError, setTaskError] = useState<string | undefined>();
  const [favoritePending, setFavoritePending] = useState(false);
  const favoriteLock = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchPending, setSearchPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  const [files, setFiles] = useState<ServerFileEntry[] | null>(null);
  const [folders, setFolders] = useState<ServerFolderEntry[]>([]);
  const [meta, setMeta] = useState<DashboardMeta>({});
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("mtime");
  const [quickAccessTab, setQuickAccessTab] =
    useState<QuickAccessTab>("recent");
  const [currentFolder, setCurrentFolder] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<ServerFileEntry[] | null>(
    null,
  );

  const [draggedFilePath, setDraggedFilePath] = useState<string | null>(null);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | null>(null);
  const suppressNextOpenRef = useRef(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
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
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Drawings — Excalidraw";
    refresh();
  }, [refresh]);

  // Ignore results from obsolete queries, including requests already in flight.
  useEffect(() => {
    let active = true;
    setSearchError(null);
    if (!searchInput.trim()) {
      setSearchResults(null);
      setSearchPending(false);
      return;
    }
    setSearchPending(true);
    setSearchResults(null);
    const timer = setTimeout(async () => {
      try {
        const results = await listFiles(searchInput);
        if (active) {
          setSearchResults(results);
        }
      } catch (cause) {
        if (active) {
          setSearchError(
            cause instanceof Error ? cause.message : "Search unavailable",
          );
        }
      } finally {
        if (active) {
          setSearchPending(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchInput, searchRevision]);

  const withErrorHandling = async (operation: () => Promise<void>) => {
    try {
      await operation();
      await refresh();
      toast.show({ title: "Drawing moved", variant: "success" });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not complete the operation.",
      );
    }
  };

  const beginTask = (next: Task, trigger?: HTMLElement | null) => {
    returnFocusRef.current =
      trigger ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setTaskValue(
      next.kind === "move" ? next.file?.folder ?? "" : next.file?.name ?? "",
    );
    setTaskError(undefined);
    setCustomDestination(false);
    setTask(next);
  };

  const onToggleFavorite = async (file: ServerFileEntry) => {
    if (favoriteLock.current) {
      return;
    }
    favoriteLock.current = true;
    setFavoritePending(true);
    try {
      const favorites = await toggleFavorite(file.path);
      setMeta((current) => ({ ...current, favorites }));
    } catch (cause) {
      setError(
        `Could not save favorite: ${
          cause instanceof Error ? cause.message : "Please try again."
        }`,
      );
    } finally {
      favoriteLock.current = false;
      setFavoritePending(false);
    }
  };

  const confirmTask = async () => {
    if (!task) {
      return;
    }
    setTaskError(undefined);
    try {
      const file = task.file;
      if (task.kind === "create" || task.kind === "rename") {
        const name = toFileName(taskValue);
        if (!name) {
          throw new Error(NAME_RULES);
        }
        const folder = file?.folder ?? currentFolder;
        const path = folder ? `${folder}/${name}` : name;
        if (file?.path === path) {
          return;
        }
        if (files?.some((entry) => entry.path === path)) {
          throw new Error(`"${taskValue.trim()}" already exists here.`);
        }
        if (task.kind === "create") {
          await createFile(path);
          window.location.hash = editorHash(path);
          return;
        }
        await renameFile(file!.path, path);
        await updateMetaPath(file!.path, path);
        returnFocusRef.current = document.getElementById("drawings-main");
      } else if (task.kind === "folder") {
        const name = toFolderPath(taskValue);
        if (!name || name.includes("/")) {
          throw new Error(NAME_RULES);
        }
        await createFolder(currentFolder ? `${currentFolder}/${name}` : name);
      } else if (task.kind === "move" && file) {
        if (customDestination && !taskValue.trim()) {
          throw new Error("Enter a destination folder path.");
        }
        const folder = toFolderPath(taskValue);
        if (folder === null) {
          throw new Error(NAME_RULES);
        }
        await moveFileToFolder(file, folder);
        returnFocusRef.current = document.getElementById("drawings-main");
      } else if (task.kind === "delete" && file) {
        await deleteFile(file.path);
        await updateMetaPath(file.path, null);
        returnFocusRef.current = document.getElementById("drawings-main");
      } else if (task.kind === "deleteFolder" && task.folder) {
        await deleteFolder(task.folder.path);
        returnFocusRef.current = document.getElementById("drawings-main");
      }
      await refresh();
      setSearchRevision((revision) => revision + 1);
      toast.show({
        title:
          task.kind === "delete" || task.kind === "deleteFolder"
            ? "Deleted successfully"
            : "Saved successfully",
        variant: "success",
      });
    } catch (cause) {
      setTaskError(
        cause instanceof Error
          ? cause.message
          : "Could not save changes. Please try again.",
      );
      throw cause;
    }
  };

  const favorites = meta.favorites ?? [];
  const isSearching = !!searchInput.trim();

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
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
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
    (files ?? []).filter(
      (file) => !currentFolder || file.folder === currentFolder,
    ),
    sortMode,
  );

  const hasQuickAccess = favoriteFiles.length > 0 || recentFiles.length > 0;

  const breadcrumb = currentFolder ? currentFolder.split("/") : [];

  const renderGrid = (entries: ServerFileEntry[]) => (
    <div className="Dashboard__grid">
      {entries.map((file) => (
        <FileCard
          key={file.path}
          file={file}
          isFavorite={favorites.includes(file.path)}
          isDragging={draggedFilePath === file.path}
          pending={favoritePending}
          onNavigate={(event) => {
            if (suppressNextOpenRef.current) {
              event.preventDefault();
              suppressNextOpenRef.current = false;
            }
          }}
          onToggleFavorite={onToggleFavorite}
          onDragStart={onFileDragStart}
          onDragEnd={onFileDragEnd}
          onAction={(action, file, trigger) =>
            beginTask(
              { kind: action as "rename" | "move" | "delete", file },
              trigger,
            )
          }
        />
      ))}
    </div>
  );
  const taskTitle = task
    ? {
        create: "New drawing",
        folder: "New folder",
        rename: "Rename drawing",
        move: "Move drawing",
        delete: "Delete drawing",
        deleteFolder: "Delete folder",
      }[task.kind]
    : "Drawing action";
  const destructive = task?.kind === "delete" || task?.kind === "deleteFolder";

  return (
    <div className="Dashboard bg-background text-foreground font-sans">
      <a
        href="#drawings-main"
        className="sr-only focus:not-sr-only"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("drawings-main")?.focus();
        }}
      >
        Skip to drawings
      </a>
      <header className="border-b">
        <div className="Dashboard__brand flex items-center justify-between gap-4 p-4">
          <span className="font-heading text-lg font-semibold">Excalidraw</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Your workspace
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                const next = !darkTheme;
                setDarkTheme(next);
                document.documentElement.dataset.mode = next ? "dark" : "light";
                try {
                  localStorage.setItem(
                    STORAGE_KEYS.LOCAL_STORAGE_THEME,
                    next ? "dark" : "light",
                  );
                } catch {
                  /* Keep the selected theme for this visit when storage is unavailable. */
                }
              }}
            >
              Toggle theme
            </Button>
          </div>
        </div>
      </header>
      <Page
        id="drawings-main"
        title="Drawings"
        description="A home for your ideas. Pick up where you left off."
        width="wide"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => beginTask({ kind: "folder" })}
            >
              New folder
            </Button>
            <Button icon="add" onClick={() => beginTask({ kind: "create" })}>
              New drawing
            </Button>
          </>
        }
      >
        <div className="Dashboard__toolbar">
          <SearchField
            label="Search drawings"
            placeholder="Search names or text inside drawings…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onClear={() => setSearchInput("")}
          />
          <Select
            label="Sort by"
            value={sortMode}
            onValueChange={(value) => setSortMode(value as SortMode)}
            options={[
              { value: "mtime", label: "Last modified" },
              { value: "name", label: "Name" },
            ]}
          />
        </div>
        {error && (
          <Alert
            variant="destructive"
            title="Workspace unavailable"
            description={error}
            action={
              <Button variant="secondary" onClick={refresh}>
                Retry
              </Button>
            }
          />
        )}
        {!files && !error && <p role="status">Loading drawings…</p>}
        {files && refreshing && <p role="status">Refreshing drawings…</p>}
        {isSearching ? (
          <Section
            title="Search results"
            description={
              searchResults
                ? `${searchResults.length} matches for "${searchInput.trim()}"`
                : undefined
            }
          >
            {searchPending ? (
              <p role="status">Searching drawings…</p>
            ) : searchError ? (
              <Alert
                title="Search unavailable"
                description={searchError}
                variant="destructive"
                action={
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setSearchRevision((revision) => revision + 1)
                    }
                  >
                    Retry search
                  </Button>
                }
              />
            ) : searchResults?.length ? (
              renderGrid(sortFiles(searchResults, sortMode))
            ) : (
              <Empty
                title="No matching drawings"
                description="Try a different name or text."
              />
            )}
          </Section>
        ) : (
          <>
            {currentFolder === "" && hasQuickAccess && (
              <Section title="Quick access">
                <Tabs
                  label="Quick access"
                  value={quickAccessTab}
                  onValueChange={(value) =>
                    setQuickAccessTab(value as QuickAccessTab)
                  }
                  tabs={[
                    { value: "recent", label: "Recent" },
                    { value: "favorites", label: "Favorites" },
                  ]}
                  renderPanel={(value) => {
                    const entries =
                      value === "favorites" ? favoriteFiles : recentFiles;
                    return entries.length ? (
                      renderGrid(entries)
                    ) : (
                      <Empty
                        title={
                          value === "favorites"
                            ? "No favorites yet"
                            : "No recent drawings yet"
                        }
                        description={
                          value === "favorites"
                            ? "Star a drawing to keep it close."
                            : "Open a drawing to see it here."
                        }
                      />
                    );
                  }}
                />
              </Section>
            )}
            <div className="Dashboard__library">
              <nav aria-label="Drawing folders" className="space-y-4">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  Folders
                </h2>
                <div className="Dashboard__folder-list">
                  <button
                    className="rounded-panel px-3 py-3 text-left hover:bg-muted"
                    onClick={() => setCurrentFolder("")}
                    {...getDropTargetProps("")}
                    aria-current={!currentFolder ? "page" : undefined}
                  >
                    All drawings
                  </button>
                  {subfolders.map((folder) => (
                    <div
                      key={folder.path}
                      className="flex items-center justify-between gap-2 rounded-panel"
                      data-drop-target={dropTargetFolder === folder.path}
                      {...getDropTargetProps(folder.path)}
                    >
                      <button
                        className="flex min-w-0 items-center gap-2 px-3 py-3 text-left"
                        onClick={() => setCurrentFolder(folder.path)}
                      >
                        <Icon name="folder" />
                        {folder.name}
                      </button>
                      <DropdownMenu
                        trigger="icon"
                        label={`Actions for folder ${folder.name}`}
                        items={[
                          {
                            id: "delete",
                            label: "Delete empty folder",
                            variant: "destructive",
                          },
                        ]}
                        onAction={(_, trigger) =>
                          beginTask({ kind: "deleteFolder", folder }, trigger)
                        }
                      />
                    </div>
                  ))}
                </div>
              </nav>
              <Section
                title={
                  currentFolder
                    ? currentFolder.split("/").pop()
                    : "All drawings"
                }
                description={`${folderFiles.length} drawings`}
              >
                {breadcrumb.length > 0 && (
                  <nav
                    aria-label="Folder path"
                    className="flex flex-wrap items-center gap-2"
                  >
                    <button
                      className="underline"
                      onClick={() => setCurrentFolder("")}
                      {...getDropTargetProps("")}
                    >
                      All drawings
                    </button>
                    {breadcrumb.map((segment, index) => {
                      const target = breadcrumb.slice(0, index + 1).join("/");
                      return (
                        <span key={target} className="flex items-center gap-2">
                          <span aria-hidden="true">/</span>
                          <button
                            className="underline"
                            aria-current={
                              target === currentFolder ? "page" : undefined
                            }
                            onClick={() => setCurrentFolder(target)}
                            {...getDropTargetProps(target)}
                          >
                            {segment}
                          </button>
                        </span>
                      );
                    })}
                  </nav>
                )}
                {folderFiles.length > 0
                  ? renderGrid(folderFiles)
                  : files && (
                      <Empty
                        title={
                          currentFolder
                            ? "This folder is empty"
                            : "Room for your next idea"
                        }
                        description="Create a drawing here, or move one from another folder."
                      >
                        <Button onClick={() => beginTask({ kind: "create" })}>
                          New drawing
                        </Button>
                      </Empty>
                    )}
              </Section>
            </div>
          </>
        )}
        <footer className="flex justify-between gap-4 border-t pt-4 text-sm text-muted-foreground">
          <span>Your drawings are saved on this server.</span>
          <a href="#scratch" className="underline">
            Scratchpad
          </a>
        </footer>
      </Page>
      <Dialog
        open={!!task}
        onOpenChange={(open) => {
          if (!open) {
            setTask(null);
          }
        }}
        title={taskTitle}
        description={
          destructive
            ? `Delete "${task?.file?.name ?? task?.folder?.name}"? ${
                task?.kind === "deleteFolder"
                  ? "Only empty folders can be deleted."
                  : "This cannot be undone."
              }`
            : task?.kind === "move"
            ? "Choose a destination folder."
            : "Use a plain name without slashes or a leading dot."
        }
        confirmLabel={
          destructive
            ? taskTitle
            : task?.kind === "move"
            ? "Move drawing"
            : task?.kind === "rename"
            ? "Rename drawing"
            : "Create"
        }
        confirmVariant={destructive ? "destructive" : "primary"}
        onConfirm={confirmTask}
        error={taskError}
        returnFocusRef={returnFocusRef}
      >
        {!destructive &&
          (task?.kind === "move" ? (
            <div className="space-y-4">
              <Select
                label="Destination folder"
                value={
                  customDestination ? "__custom__" : taskValue || "__root__"
                }
                onValueChange={(value) => {
                  setCustomDestination(value === "__custom__");
                  setTaskValue(
                    value === "__root__" || value === "__custom__" ? "" : value,
                  );
                }}
                options={[
                  { value: "__root__", label: "All drawings" },
                  { value: "__custom__", label: "New folder path…" },
                  ...folders.map((folder) => ({
                    value: folder.path,
                    label: folder.path,
                  })),
                ]}
              />
              {customDestination && (
                <TextField
                  label="Folder path"
                  description="Use a/b for nested folders. Missing folders will be created."
                  value={taskValue}
                  onChange={(event) => setTaskValue(event.target.value)}
                />
              )}
            </div>
          ) : (
            <TextField
              label="Name"
              value={taskValue}
              onChange={(event) => setTaskValue(event.target.value)}
            />
          ))}
      </Dialog>
    </div>
  );
};

export const Dashboard = () => {
  useEffect(() => {
    const root = document.documentElement;
    const previous = {
      mode: root.getAttribute("data-mode"),
      density: root.getAttribute("data-density"),
    };
    const style = document.createElement("style");
    style.dataset.prismDashboard = "true";
    style.textContent = prismStyles;
    document.head.appendChild(style);
    root.dataset.mode = isDarkTheme() ? "dark" : "light";
    root.dataset.density = "comfortable";
    return () => {
      style.remove();
      for (const [key, value] of Object.entries(previous)) {
        if (value === null) {
          root.removeAttribute(`data-${key}`);
        } else {
          root.setAttribute(`data-${key}`, value);
        }
      }
    };
  }, []);
  return (
    <ToastProvider>
      <DashboardContent />
    </ToastProvider>
  );
};
