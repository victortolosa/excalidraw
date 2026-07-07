import { useAtomValue } from "../app-jotai";
import { getOpenServerFile, serverSaveStatusAtom } from "../data/serverStorage";

import "./ServerSaveStatus.scss";

const LABELS = {
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — will retry (kept locally)",
  "session-expired": "Session expired — click to sign in again",
} as const;

/**
 * Save-state pill for server files (self-hosted dashboard fork). Renders
 * nothing in scratch mode, so stock usage is visually untouched.
 */
export const ServerSaveStatus = () => {
  const status = useAtomValue(serverSaveStatusAtom);

  if (!status) {
    return null;
  }

  const isClickable = status === "session-expired";

  return (
    <div
      className={`ServerSaveStatus ServerSaveStatus--${status} ${
        isClickable ? "ServerSaveStatus--clickable" : ""
      }`}
      title={getOpenServerFile() ?? undefined}
      onClick={isClickable ? () => window.location.reload() : undefined}
    >
      {LABELS[status]}
    </div>
  );
};
