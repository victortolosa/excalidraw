import { useEffect, useState } from "react";

import ExcalidrawApp from "../App";

import { Dashboard } from "./Dashboard";
import { QuickSwitcher } from "./QuickSwitcher";

/**
 * Hash router for the self-hosted dashboard fork:
 * - `#/d/<path>` → editor with a server file (handled inside ExcalidrawApp)
 * - `#/…` (anything else under `#/`) → dashboard
 * - no hash / stock hashes (`#json=`, `#room=`, …) → stock editor
 */
const isDashboardHash = (hash: string) =>
  hash.startsWith("#/") && !hash.startsWith("#/d/");

const getRoute = () =>
  isDashboardHash(window.location.hash) ? "dashboard" : "editor";

export const DashboardRoot = () => {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <>
      {route === "dashboard" ? <Dashboard /> : <ExcalidrawApp />}
      <QuickSwitcher />
    </>
  );
};
