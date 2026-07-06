import { useAtomValue } from "../app-jotai";
import { getOpenServerFile, serverSaveStatusAtom } from "../data/serverStorage";

import "./ServerSaveStatus.scss";

const LABELS = {
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed — will retry",
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

  return (
    <div
      className={`ServerSaveStatus ServerSaveStatus--${status}`}
      title={getOpenServerFile() ?? undefined}
    >
      {LABELS[status]}
    </div>
  );
};
