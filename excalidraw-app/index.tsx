import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "../excalidraw-app/sentry";

// fork: hash router in front of the editor (dashboard at #/, see DASHBOARD_PLAN.md)
import { DashboardRoot } from "./dashboard/DashboardRoot";

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
root.render(
  <StrictMode>
    <DashboardRoot />
  </StrictMode>,
);
