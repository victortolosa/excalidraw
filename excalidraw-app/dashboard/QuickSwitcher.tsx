import { useCallback, useEffect, useRef, useState } from "react";

import { editorHash, listFiles } from "./api";

import "./QuickSwitcher.scss";

import type { ServerFileEntry } from "./api";

const MAX_RESULTS = 10;

/**
 * Cmd/Ctrl+K file switcher. Mounted once in DashboardRoot so it works in
 * both the dashboard and the editor (Excalidraw's own palette lives on
 * Cmd+/ and Cmd+Shift+P — no conflict).
 */
export const QuickSwitcher = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<ServerFileEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        setOpen((wasOpen) => !wasOpen);
        setQuery("");
        setSelected(0);
      }
    };
    // capture phase so the editor's global key handling never sees it
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    if (open) {
      listFiles()
        .then((loaded) =>
          setFiles([...loaded].sort((a, b) => b.mtime - a.mtime)),
        )
        .catch(() => setFiles([]));
      // autofocus once the overlay has rendered
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = files
    .filter((file) => file.path.toLowerCase().includes(query.toLowerCase()))
    .slice(0, MAX_RESULTS);

  const choose = useCallback((file: ServerFileEntry) => {
    setOpen(false);
    window.location.hash = editorHash(file.path);
  }, []);

  if (!open) {
    return null;
  }

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && results[selected]) {
      choose(results[selected]);
    }
  };

  return (
    <div className="QuickSwitcher" onClick={() => setOpen(false)}>
      <div
        className="QuickSwitcher__panel"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          placeholder="Open drawing…"
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onInputKeyDown}
        />
        <ul>
          {results.map((file, index) => (
            <li
              key={file.path}
              className={index === selected ? "is-selected" : ""}
              onMouseEnter={() => setSelected(index)}
              onClick={() => choose(file)}
            >
              <span className="QuickSwitcher__name">{file.name}</span>
              {file.folder && (
                <span className="QuickSwitcher__folder">{file.folder}</span>
              )}
            </li>
          ))}
          {results.length === 0 && (
            <li className="QuickSwitcher__empty">No matching drawings</li>
          )}
        </ul>
      </div>
    </div>
  );
};
