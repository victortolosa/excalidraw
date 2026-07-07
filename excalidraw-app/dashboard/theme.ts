import { STORAGE_KEYS } from "../app_constants";

/**
 * Match the editor's theme setting (default light, like stock Excalidraw;
 * "system" follows the OS). Read at mount — route changes remount the
 * dashboard, which is enough parity for a settings toggle.
 */
export const isDarkTheme = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_THEME);
    if (stored === "dark") {
      return true;
    }
    if (stored === "system") {
      return (
        window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false
      );
    }
    return false;
  } catch {
    return false;
  }
};

export const themeClass = (base: string) =>
  isDarkTheme() ? `${base} theme--dark` : base;
