import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { vi } from "vitest";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

const SCENE_ON_SERVER = {
  type: "excalidraw",
  version: 2,
  elements: [API.createElement({ type: "rectangle", id: "srv-rect" })],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
};

const jsonResponse = (
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });

// fresh module state per test (serverStorage keeps module-level state)
const importServerStorage = async () => {
  vi.resetModules();
  return await import("../data/serverStorage");
};

const makeAppState = () => getDefaultAppState() as unknown as AppState;

// API.createElement fixtures don't carry a fractional index; the save path
// only serializes them, so the looser type is fine here
const asOrdered = (elements: readonly unknown[]) =>
  elements as readonly OrderedExcalidrawElement[];

describe("serverStorage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("parseServerHash", () => {
    it("accepts #/d/ paths to .excalidraw files only", async () => {
      const { parseServerHash } = await importServerStorage();
      expect(parseServerHash("#/d/a.excalidraw")).toBe("a.excalidraw");
      expect(parseServerHash("#/d/sub/a.excalidraw")).toBe("sub/a.excalidraw");
      expect(parseServerHash("#/d/my%20file.excalidraw")).toBe(
        "my file.excalidraw",
      );
      expect(parseServerHash("#/d/a.txt")).toBe(null);
      expect(parseServerHash("#/dashboard")).toBe(null);
      expect(parseServerHash("#json=abc,def")).toBe(null);
      expect(parseServerHash("")).toBe(null);
    });
  });

  describe("loadServerScene", () => {
    it("restores a scene from the server and enters server mode", async () => {
      const storage = await importServerStorage();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(SCENE_ON_SERVER, { headers: { "X-Mtime": "12345" } }),
      );

      const scene = await storage.loadServerScene("a.excalidraw");

      expect(fetchMock).toHaveBeenCalledWith("/api/files/a.excalidraw");
      expect(storage.isServerFileOpen()).toBe(true);
      expect(storage.getOpenServerFile()).toBe("a.excalidraw");
      expect(scene.elements).toHaveLength(1);
      expect(scene.elements?.[0].id).toBe("srv-rect");
    });

    it("treats 404 as a new empty drawing", async () => {
      const storage = await importServerStorage();
      fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 404 }));

      const scene = await storage.loadServerScene("new.excalidraw");

      expect(storage.isServerFileOpen()).toBe(true);
      expect(scene.elements).toEqual([]);
    });

    it("blocks saves after a failed load (never clobber the file)", async () => {
      const storage = await importServerStorage();
      fetchMock.mockRejectedValueOnce(new Error("network down"));

      const scene = await storage.loadServerScene("a.excalidraw");
      expect(scene.appState?.errorMessage).toContain("a.excalidraw");
      // still "open" so scratch behavior doesn't kick in…
      expect(storage.isServerFileOpen()).toBe(true);

      // …but saving must be a no-op
      fetchMock.mockClear();
      storage.saveToServer(asOrdered([]), makeAppState(), {} as BinaryFiles);
      await storage.flushServerSave();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("saveToServer + flushServerSave", () => {
    const openFile = async (storage: any, path = "a.excalidraw") => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(SCENE_ON_SERVER, { headers: { ETag: '"v1"' } }),
      );
      await storage.loadServerScene(path);
      fetchMock.mockClear();
    };

    const changedScene = (id: string) =>
      asOrdered([
        ...SCENE_ON_SERVER.elements,
        API.createElement({ type: "ellipse", id }),
      ]);

    // a fetch mock that resolves only when we say so — lets a test hold a PUT
    // "in flight" and observe what the save loop does around it
    const deferredResponse = () => {
      let resolve!: (r: Response) => void;
      const promise = new Promise<Response>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };

    it("PUTs the changed scene on flush", async () => {
      const storage = await importServerStorage();
      await openFile(storage);

      const newElement = API.createElement({ type: "ellipse", id: "el-2" });
      fetchMock.mockResolvedValueOnce(jsonResponse({ mtime: 200 }));

      storage.saveToServer(
        asOrdered([...SCENE_ON_SERVER.elements, newElement]),
        makeAppState(),
        {},
      );
      await storage.flushServerSave();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/files/a.excalidraw");
      expect(options.method).toBe("PUT");
      const payload = JSON.parse(options.body);
      expect(payload.type).toBe("excalidraw");
      expect(payload.elements.map((el: any) => el.id)).toEqual([
        "srv-rect",
        "el-2",
      ]);
    });

    it("skips the PUT when the scene is unchanged since load", async () => {
      const storage = await importServerStorage();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(SCENE_ON_SERVER, { headers: { "X-Mtime": "100" } }),
      );
      const scene = await storage.loadServerScene("a.excalidraw");
      fetchMock.mockClear();

      // onChange fires with the loaded scene right away (and again on
      // selection / viewport changes) — those must not produce traffic
      storage.saveToServer(
        asOrdered(scene.elements ?? []),
        scene.appState as AppState,
        scene.files as BinaryFiles,
      );
      await storage.flushServerSave();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips the PUT when re-saving already-saved content", async () => {
      const storage = await importServerStorage();
      await openFile(storage);

      const elements = [
        ...SCENE_ON_SERVER.elements,
        API.createElement({ type: "ellipse", id: "el-2" }),
      ];
      fetchMock.mockResolvedValueOnce(jsonResponse({ mtime: 200 }));

      storage.saveToServer(asOrdered(elements), makeAppState(), {});
      await storage.flushServerSave();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // identical content again → no second PUT
      storage.saveToServer(asOrdered(elements), makeAppState(), {});
      await storage.flushServerSave();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("retains a failed save and retries on next flush", async () => {
      const storage = await importServerStorage();
      await openFile(storage);

      const elements = [
        ...SCENE_ON_SERVER.elements,
        API.createElement({ type: "ellipse", id: "el-2" }),
      ];
      fetchMock.mockRejectedValueOnce(new Error("server gone"));

      storage.saveToServer(asOrdered(elements), makeAppState(), {});
      await storage.flushServerSave();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockResolvedValueOnce(jsonResponse({ mtime: 300 }));
      await storage.flushServerSave();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
    });

    it("debounces saves (no PUT before the debounce window)", async () => {
      vi.useFakeTimers();
      try {
        const storage = await importServerStorage();

        fetchMock.mockResolvedValueOnce(
          jsonResponse(SCENE_ON_SERVER, { headers: { "X-Mtime": "100" } }),
        );
        const loadPromise = storage.loadServerScene("a.excalidraw");
        await vi.runAllTimersAsync();
        await loadPromise;
        fetchMock.mockClear();

        fetchMock.mockResolvedValueOnce(jsonResponse({ mtime: 200 }));
        storage.saveToServer(
          asOrdered([
            ...SCENE_ON_SERVER.elements,
            API.createElement({ type: "ellipse", id: "el-2" }),
          ]),
          makeAppState(),
          {},
        );

        await vi.advanceTimersByTimeAsync(1000);
        expect(fetchMock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(3000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("flush awaits the in-flight save and drains a newer edit after it", async () => {
      const storage = await importServerStorage();
      await openFile(storage);

      const first = deferredResponse();
      fetchMock
        .mockReturnValueOnce(first.promise) // first PUT: held in flight
        .mockResolvedValueOnce(jsonResponse({ version: '"v3"' })); // second PUT

      storage.saveToServer(changedScene("el-2"), makeAppState(), {});
      const flush = storage.flushServerSave();

      // a newer edit lands while the first request is still in flight
      storage.saveToServer(changedScene("el-3"), makeAppState(), {});

      // release the first PUT; flush must not resolve until the queue is clean
      first.resolve(jsonResponse({ version: '"v2"' }));
      await flush;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      // the second PUT carries the newest edit…
      const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(secondBody.elements.map((el: any) => el.id)).toContain("el-3");
      // …and the baseline refreshed from the first ack, not the stale load
      expect(fetchMock.mock.calls[1][1].headers["X-Base-Version"]).toBe('"v2"');
    });

    it("repeated flush calls share a single drain", async () => {
      const storage = await importServerStorage();
      await openFile(storage);

      const put = deferredResponse();
      fetchMock.mockReturnValueOnce(put.promise);

      storage.saveToServer(changedScene("el-2"), makeAppState(), {});
      const a = storage.flushServerSave();
      const b = storage.flushServerSave();

      put.resolve(jsonResponse({ version: '"v2"' }));
      await Promise.all([a, b]);

      // both awaited the same loop → exactly one PUT
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not report 'saved' until the server acknowledges", async () => {
      const storage = await importServerStorage();
      const { appJotaiStore } = await import("../app-jotai");
      await openFile(storage);
      const status = () => appJotaiStore.get(storage.serverSaveStatusAtom);

      const put = deferredResponse();
      fetchMock.mockReturnValueOnce(put.promise);

      storage.saveToServer(changedScene("el-2"), makeAppState(), {});
      const flush = storage.flushServerSave();

      // request is in flight — status is "saving", never prematurely "saved"
      expect(status()).toBe("saving");

      put.resolve(jsonResponse({ version: '"v2"' }));
      await flush;

      expect(status()).toBe("saved");
    });
  });

  describe("conflict guard + recovery + session expiry (Phase 5)", () => {
    const RECOVERY_KEY = "excalidraw-server-recovery:a.excalidraw";

    const openFile = async (storage: any) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(SCENE_ON_SERVER, { headers: { ETag: '"v1"' } }),
      );
      await storage.loadServerScene("a.excalidraw");
      fetchMock.mockClear();
    };

    const changedElements = () =>
      asOrdered([
        ...SCENE_ON_SERVER.elements,
        API.createElement({ type: "ellipse", id: "el-2" }),
      ]);

    afterEach(() => {
      localStorage.clear();
    });

    it("sends the version baseline with every guarded PUT", async () => {
      const storage = await importServerStorage();
      await openFile(storage);

      fetchMock.mockResolvedValueOnce(jsonResponse({ version: '"v2"' }));
      storage.saveToServer(changedElements(), makeAppState(), {});
      await storage.flushServerSave();

      expect(fetchMock.mock.calls[0][1].headers["X-Base-Version"]).toBe('"v1"');
    });

    it("overwrites without the baseline after a confirmed 409", async () => {
      const storage = await importServerStorage();
      await openFile(storage);

      vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ error: "conflict", version: '"v9"' }, { status: 409 }),
        )
        .mockResolvedValueOnce(jsonResponse({ version: '"v10"' }));

      storage.saveToServer(changedElements(), makeAppState(), {});
      await storage.flushServerSave();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      // retry must be unconditional (no baseline header)
      expect(
        fetchMock.mock.calls[1][1].headers["X-Base-Version"],
      ).toBeUndefined();
    });

    it("keeps a localStorage recovery copy when a save fails", async () => {
      const storage = await importServerStorage();
      await openFile(storage);

      fetchMock.mockRejectedValueOnce(new Error("server down"));
      storage.saveToServer(changedElements(), makeAppState(), {});
      await storage.flushServerSave();

      const recovered = localStorage.getItem(RECOVERY_KEY);
      expect(recovered).toBeTruthy();
      expect(JSON.parse(recovered!).elements.map((el: any) => el.id)).toContain(
        "el-2",
      );

      // successful retry clears the recovery copy
      fetchMock.mockResolvedValueOnce(jsonResponse({ mtime: 300 }));
      await storage.flushServerSave();
      expect(localStorage.getItem(RECOVERY_KEY)).toBe(null);
    });

    it("offers to restore a recovery copy on the next load", async () => {
      const storage = await importServerStorage();

      const recoveryScene = {
        ...SCENE_ON_SERVER,
        elements: [
          ...SCENE_ON_SERVER.elements,
          API.createElement({ type: "diamond", id: "recovered-el" }),
        ],
      };
      localStorage.setItem(RECOVERY_KEY, JSON.stringify(recoveryScene));

      vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
      fetchMock.mockResolvedValueOnce(
        jsonResponse(SCENE_ON_SERVER, { headers: { "X-Mtime": "100" } }),
      );

      const scene = await storage.loadServerScene("a.excalidraw");
      expect(scene.elements?.map((el: any) => el.id)).toContain("recovered-el");
    });

    it("flags an auth wall (HTML response) as session-expired, keeps work", async () => {
      const storage = await importServerStorage();
      await openFile(storage);

      fetchMock.mockResolvedValueOnce(
        new Response("<html>Cloudflare Access login</html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      );

      storage.saveToServer(changedElements(), makeAppState(), {});
      await storage.flushServerSave();

      expect(localStorage.getItem(RECOVERY_KEY)).toBeTruthy();
    });
  });

  describe("leaving server mode", () => {
    it("closes the server file when the hash no longer points at one", async () => {
      const storage = await importServerStorage();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(SCENE_ON_SERVER, { headers: { "X-Mtime": "100" } }),
      );
      await storage.loadServerScene("a.excalidraw");
      expect(storage.isServerFileOpen()).toBe(true);

      window.location.hash = "";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      // hashchange handler flushes async; give it a tick
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(storage.isServerFileOpen()).toBe(false);
    });
  });
});
