/**
 * Dashboard metadata (`.dashboard.json` in the data dir) — favorites and
 * recently-opened files. Single-user homelab: last write wins is fine.
 */

export interface DashboardMeta {
  favorites?: string[];
  recents?: string[];
}

const MAX_RECENTS = 12;

export const getMeta = async (): Promise<DashboardMeta> => {
  try {
    const response = await fetch("/api/meta");
    if (!response.ok) {
      return {};
    }
    return await response.json();
  } catch {
    return {};
  }
};

export const putMeta = async (meta: DashboardMeta) => {
  await fetch("/api/meta", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
};

export const toggleFavorite = async (path: string) => {
  const meta = await getMeta();
  const favorites = meta.favorites ?? [];
  const next = favorites.includes(path)
    ? favorites.filter((favorite) => favorite !== path)
    : [...favorites, path];
  await putMeta({ ...meta, favorites: next });
  return next;
};

/** Called after a drawing is opened; fire-and-forget from serverStorage. */
export const recordRecent = async (path: string) => {
  const meta = await getMeta();
  const recents = [
    path,
    ...(meta.recents ?? []).filter((recent) => recent !== path),
  ].slice(0, MAX_RECENTS);
  await putMeta({ ...meta, recents });
};

/** Keep meta consistent when a file is renamed or deleted. */
export const updateMetaPath = async (from: string, to: string | null) => {
  const meta = await getMeta();
  const map = (paths?: string[]) =>
    paths
      ?.map((p) => (p === from ? to : p))
      .filter((p): p is string => p !== null);
  await putMeta({
    ...meta,
    favorites: map(meta.favorites),
    recents: map(meta.recents),
  });
};
