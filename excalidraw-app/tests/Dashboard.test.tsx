import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { vi } from "vitest";

import { Dashboard } from "../dashboard/Dashboard";

const now = new Date("2026-07-08T12:00:00Z").getTime();

const files = [
  {
    path: "root-board.excalidraw",
    name: "Root board",
    folder: "",
    mtime: now,
    size: 128,
    hasThumbnail: false,
  },
  {
    path: "projects/roadmap.excalidraw",
    name: "Roadmap",
    folder: "projects",
    mtime: now - 86_400_000,
    size: 256,
    hasThumbnail: true,
  },
];

const folders = [{ path: "projects", name: "projects" }];
const meta = {
  favorites: ["root-board.excalidraw"],
  recents: ["projects/roadmap.excalidraw"],
};

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });

const urlOf = (input: RequestInfo | URL) =>
  typeof input === "string"
    ? input
    : input instanceof URL
    ? input.pathname + input.search
    : input.url;

const createFetchMock = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const method = init?.method ?? "GET";

    if (url === "/api/files" && method === "GET") {
      return jsonResponse(files);
    }
    if (url === "/api/files?q=road" && method === "GET") {
      return jsonResponse([files[1]]);
    }
    if (url === "/api/folders" && method === "GET") {
      return jsonResponse(folders);
    }
    if (url === "/api/meta" && method === "GET") {
      return jsonResponse(meta);
    }
    if (url === "/api/files/New%20map.excalidraw" && method === "PUT") {
      return jsonResponse({ ok: true });
    }

    return jsonResponse(
      { error: `Unhandled ${method} ${url}` },
      { status: 500 },
    );
  });

describe("Dashboard", () => {
  let fetchMock: ReturnType<typeof createFetchMock>;

  beforeEach(() => {
    fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders server files, folders, favorites, and recents", async () => {
    const { container } = render(<Dashboard />);

    expect(
      await screen.findByRole("heading", { name: "Drawings" }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText("Root board")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText(/128 B/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "projects" }),
    ).toBeInTheDocument();

    expect(screen.getByRole("tab", { name: "Favorites" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Recent" }));
    expect(screen.getAllByText("Roadmap").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/256 B/).length).toBeGreaterThan(0);

    const thumbnail = container.querySelector(".Dashboard__thumbnail img");
    expect(thumbnail).toBeInstanceOf(HTMLImageElement);
    if (!(thumbnail instanceof HTMLImageElement)) {
      throw new Error("expected a dashboard thumbnail image");
    }
    expect(thumbnail.getAttribute("loading")).toBe("lazy");
    expect(thumbnail.getAttribute("decoding")).toBe("async");

    const placeholdersBefore = container.querySelectorAll(
      ".Dashboard__thumbnail-placeholder",
    ).length;
    fireEvent.error(thumbnail);
    expect(
      container.querySelectorAll(".Dashboard__thumbnail-placeholder").length,
    ).toBe(placeholdersBefore + 1);
  });

  it("creates a drawing in the current folder and opens it", async () => {
    render(<Dashboard />);
    await screen.findAllByText("Root board");

    fireEvent.click(screen.getByRole("button", { name: "New drawing" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "New map" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/files/New%20map.excalidraw",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({ "If-None-Match": "*" }),
        }),
      ),
    );
    expect(window.location.hash).toBe("#/d/New%20map.excalidraw");
  });

  it("stays on the dashboard when another tab already created the drawing", async () => {
    render(<Dashboard />);
    await screen.findAllByText("Root board");
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "target already exists" }, { status: 412 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "New drawing" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "New map" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("target already exists"),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("searches drawings through the server after a debounce", async () => {
    render(<Dashboard />);
    await screen.findAllByText("Root board");

    vi.useFakeTimers();

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "road" },
    });

    expect(
      fetchMock.mock.calls.some(([url]) => urlOf(url) === "/api/files?q=road"),
    ).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    await screen.findByRole("heading", { name: "Search results" });
    expect(screen.getByText('1 matches for "road"')).toBeInTheDocument();
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
  });
  it("keeps invalid names in the dialog without creating a file", async () => {
    render(<Dashboard />);
    await screen.findAllByText("Root board");
    fireEvent.click(screen.getByRole("button", { name: "New drawing" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "bad/name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText(/Please use a plain name/),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });

  it("retains favorite state and reports failed metadata saves", async () => {
    render(<Dashboard />);
    await screen.findAllByText("Root board");
    fireEvent.click(screen.getByRole("tab", { name: "Favorites" }));
    const favorite = screen.getAllByRole("button", {
      name: "Favorite Root board",
    })[0];
    fireEvent.click(favorite);
    expect(
      await screen.findByText(/Could not save favorite/),
    ).toBeInTheDocument();
    expect(favorite).toHaveAttribute("aria-pressed", "true");
    expect(favorite).not.toHaveAttribute("aria-busy");
  });

  it("ignores a stale search response after the search is cleared", async () => {
    let resolveSearch!: (value: Response) => void;
    const normalFetch = createFetchMock();
    fetchMock.mockImplementation((input, init) =>
      urlOf(input) === "/api/files?q=road"
        ? new Promise<Response>((resolve) => {
            resolveSearch = resolve;
          })
        : normalFetch(input, init),
    );
    render(<Dashboard />);
    await screen.findAllByText("Root board");
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "road" },
    });
    await waitFor(() => expect(resolveSearch).toBeDefined());
    fireEvent.click(
      screen.getByRole("button", { name: "Clear Search drawings" }),
    );
    await act(async () => {
      resolveSearch(jsonResponse([files[1]]));
    });
    expect(
      screen.queryByRole("heading", { name: "Search results" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("removes Prism global CSS and restores theme attributes on unmount", () => {
    document.documentElement.dataset.mode = "dark";
    const { unmount } = render(<Dashboard />);
    expect(
      document.head.querySelector("style[data-prism-dashboard]"),
    ).not.toBeNull();
    unmount();
    expect(
      document.head.querySelector("style[data-prism-dashboard]"),
    ).toBeNull();
    expect(document.documentElement.dataset.mode).toBe("dark");
    delete document.documentElement.dataset.mode;
  });
});
