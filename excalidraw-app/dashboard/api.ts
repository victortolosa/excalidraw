/** API client for the self-hosted file server (`server/`). */

export interface ServerFileEntry {
  path: string;
  name: string;
  folder: string;
  mtime: number;
  size: number;
  hasThumbnail: boolean;
}

const encodePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

const EMPTY_SCENE = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "self-hosted-dashboard",
  elements: [],
  appState: {},
  files: {},
});

const expectOk = async (response: Response) => {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) {
        detail = body.error;
      }
    } catch {
      // not JSON — keep the status text
    }
    throw new Error(detail);
  }
  return response;
};

export interface ServerFolderEntry {
  path: string;
  name: string;
}

export const listFiles = async (query?: string): Promise<ServerFileEntry[]> =>
  (
    await expectOk(
      await fetch(
        query?.trim()
          ? `/api/files?q=${encodeURIComponent(query.trim())}`
          : "/api/files",
      ),
    )
  ).json();

export const listFolders = async (): Promise<ServerFolderEntry[]> =>
  (await expectOk(await fetch("/api/folders"))).json();

export const createFolder = async (path: string) => {
  await expectOk(
    await fetch(`/api/folders/${encodePath(path)}`, { method: "POST" }),
  );
};

export const deleteFolder = async (path: string) => {
  await expectOk(
    await fetch(`/api/folders/${encodePath(path)}`, { method: "DELETE" }),
  );
};

export const createFile = async (path: string) => {
  await expectOk(
    await fetch(`/api/files/${encodePath(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: EMPTY_SCENE,
    }),
  );
};

export const renameFile = async (from: string, to: string) => {
  await expectOk(
    await fetch(`/api/files/${encodePath(from)}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    }),
  );
};

export const deleteFile = async (path: string) => {
  await expectOk(
    await fetch(`/api/files/${encodePath(path)}`, { method: "DELETE" }),
  );
};

/** mtime busts the browser cache after each save */
export const thumbnailUrl = (entry: ServerFileEntry) =>
  `/api/files/${encodePath(entry.path)}/thumbnail?mtime=${entry.mtime}`;

export const editorHash = (path: string) => `#/d/${encodePath(path)}`;
