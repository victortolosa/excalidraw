import clsx from "clsx";
import { useState } from "react";

import { PATTERN_GRID_SUBDIVISIONS, getPatternGridSize } from "../patternGrid";

import { gridIcon } from "./icons";
import { Island } from "./Island";

import "./PatternGridWidget.scss";

import type { AppState } from "../types";

type PatternGridWidgetProps = {
  appState: Pick<
    AppState,
    | "patternGridModeEnabled"
    | "patternGridSnapEnabled"
    | "patternGridLabelsEnabled"
    | "patternGridMeasurementsEnabled"
    | "patternGridMeasurementsSelectedOnly"
    | "patternGridPixelsPerInch"
    | "patternGridSubdivisions"
    | "objectsSnapModeEnabled"
  >;
  setAppState: React.Component<any, AppState>["setState"];
};

const getSubdivisionLabel = (subdivision: number) => {
  return subdivision === 1 ? `1"` : `1/${subdivision}"`;
};

export const PatternGridWidget = ({
  appState,
  setAppState,
}: PatternGridWidgetProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const minorGridSize = getPatternGridSize(appState);

  const setPatternGridModeEnabled = (enabled: boolean) => {
    setAppState((state) => ({
      patternGridModeEnabled: enabled,
      objectsSnapModeEnabled:
        enabled && state.patternGridSnapEnabled
          ? false
          : state.objectsSnapModeEnabled,
    }));
  };

  const setPatternGridSnapEnabled = (enabled: boolean) => {
    setAppState({
      patternGridSnapEnabled: enabled,
      objectsSnapModeEnabled: enabled ? false : appState.objectsSnapModeEnabled,
    });
  };

  return (
    <Island
      padding={0}
      className={clsx("PatternGridWidget", {
        "PatternGridWidget--enabled": appState.patternGridModeEnabled,
        "PatternGridWidget--expanded": isExpanded,
      })}
    >
      <button
        type="button"
        className="PatternGridWidget__summary"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="PatternGridWidget__icon">{gridIcon}</span>
        <span className="PatternGridWidget__summaryText">
          <span>Pattern grid</span>
          <span>{`1" = ${appState.patternGridPixelsPerInch}px`}</span>
        </span>
      </button>
      {isExpanded && (
        <div className="PatternGridWidget__controls">
          <label className="PatternGridWidget__toggle">
            <span>Overlay</span>
            <input
              type="checkbox"
              checked={appState.patternGridModeEnabled}
              onChange={() =>
                setPatternGridModeEnabled(!appState.patternGridModeEnabled)
              }
            />
          </label>
          <label className="PatternGridWidget__toggle">
            <span>Snap</span>
            <input
              type="checkbox"
              checked={appState.patternGridSnapEnabled}
              onChange={() =>
                setPatternGridSnapEnabled(!appState.patternGridSnapEnabled)
              }
            />
          </label>
          <label className="PatternGridWidget__toggle">
            <span>Labels</span>
            <input
              type="checkbox"
              checked={appState.patternGridLabelsEnabled}
              onChange={() =>
                setAppState({
                  patternGridLabelsEnabled: !appState.patternGridLabelsEnabled,
                })
              }
            />
          </label>
          <label className="PatternGridWidget__toggle">
            <span>Measurements</span>
            <input
              type="checkbox"
              checked={appState.patternGridMeasurementsEnabled}
              onChange={() =>
                setAppState({
                  patternGridMeasurementsEnabled:
                    !appState.patternGridMeasurementsEnabled,
                })
              }
            />
          </label>
          <label className="PatternGridWidget__toggle">
            <span>Always on</span>
            <input
              type="checkbox"
              checked={!appState.patternGridMeasurementsSelectedOnly}
              disabled={!appState.patternGridMeasurementsEnabled}
              onChange={() =>
                setAppState({
                  patternGridMeasurementsSelectedOnly:
                    !appState.patternGridMeasurementsSelectedOnly,
                })
              }
            />
          </label>
          <div className="PatternGridWidget__section">
            <div className="PatternGridWidget__sectionLabel">Subdivision</div>
            <div className="PatternGridWidget__segments">
              {PATTERN_GRID_SUBDIVISIONS.map((subdivision) => (
                <button
                  type="button"
                  key={subdivision}
                  aria-pressed={
                    appState.patternGridSubdivisions === subdivision
                  }
                  className={clsx("PatternGridWidget__segment", {
                    "PatternGridWidget__segment--active":
                      appState.patternGridSubdivisions === subdivision,
                  })}
                  onClick={() =>
                    setAppState({
                      patternGridSubdivisions: subdivision,
                    })
                  }
                >
                  {getSubdivisionLabel(subdivision)}
                </button>
              ))}
            </div>
          </div>
          <div className="PatternGridWidget__meta">
            {`${minorGridSize}px minor grid`}
          </div>
        </div>
      )}
    </Island>
  );
};
