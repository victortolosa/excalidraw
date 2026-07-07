import { useEffect, useState } from "react";

import ExcalidrawApp from "../App";

import { Dashboard } from "./Dashboard";
import { QuickSwitcher } from "./QuickSwitcher";

/**
 * Hash router for the self-hosted dashboard fork:
 * - no hash / `#/…` → dashboard (the homepage)
 * - `#/d/<path>` → editor with a server file (handled inside ExcalidrawApp)
 * - `#scratch` and stock hashes (`#json=`, `#room=`, …) → stock editor
 */
const isDashboardHash = (hash: string) =>
  hash === "" ||
  hash === "#" ||
  (hash.startsWith("#/") && !hash.startsWith("#/d/"));

const getRoute = () =>
  isDashboardHash(window.location.hash) ? "dashboard" : "editor";

export const DashboardRoot = () => {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const isDashboard = route === "dashboard";
    document.documentElement.classList.toggle(
      "excalidraw-dashboard-route",
      isDashboard,
    );
    document.body.classList.toggle("excalidraw-dashboard-route", isDashboard);

    return () => {
      document.documentElement.classList.remove("excalidraw-dashboard-route");
      document.body.classList.remove("excalidraw-dashboard-route");
    };
  }, [route]);

  return (
    <>
      {route === "dashboard" ? <Dashboard /> : <ExcalidrawApp />}
      <QuickSwitcher />
    </>
  );
};
