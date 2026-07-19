import clsx from "clsx";
import { useEffect, useState } from "react";

import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  PATTERN_GRID_PIXELS_PER_INCH_PRESETS,
  PATTERN_GRID_SEAM_ALLOWANCE_PRESETS,
  PATTERN_GRID_SUBDIVISIONS,
  MAX_PATTERN_GRID_SEAM_ALLOWANCE_INCHES,
  MIN_PATTERN_GRID_SEAM_ALLOWANCE_INCHES,
  getNormalizedPatternGridPixelsPerInch,
  getNormalizedPatternGridSeamAllowanceInches,
  getPatternGridSize,
} from "../patternGrid";
import {
  getSeamAllowanceGeometry,
  getSeamAllowanceMeasurements,
} from "../seamAllowance";

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
    | "patternGridEdgeLengthsEnabled"
    | "patternGridSeamAllowanceEnabled"
    | "patternGridSeamAllowanceInches"
    | "patternGridPixelsPerInch"
    | "patternGridSubdivisions"
    | "selectedElementIds"
    | "objectsSnapModeEnabled"
  >;
  setAppState: React.Component<any, AppState>["setState"];
  elements: readonly NonDeletedExcalidrawElement[];
  elementsMap: ElementsMap;
};

const getSubdivisionLabel = (subdivision: number) => {
  return subdivision === 1 ? `1"` : `1/${subdivision}"`;
};

const SEAM_ALLOWANCE_FRACTION_LABELS: Record<string, string> = {
  "0.25": "1/4",
  "0.375": "3/8",
  "0.5": "1/2",
  "0.625": "5/8",
};

const getSeamAllowanceLabel = (value: number) =>
  `${SEAM_ALLOWANCE_FRACTION_LABELS[String(value)] ?? value}"`;

const formatWidgetInches = (value: number, pixelsPerInch: number) => {
  const inches = value / pixelsPerInch;
  const rounded = Math.round(inches * 10) / 10;

  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
};

export const PatternGridWidget = ({
  appState,
  setAppState,
  elements,
  elementsMap,
}: PatternGridWidgetProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [scaleInput, setScaleInput] = useState(
    String(appState.patternGridPixelsPerInch),
  );
  const [seamAllowanceInput, setSeamAllowanceInput] = useState(
    String(appState.patternGridSeamAllowanceInches),
  );
  const minorGridSize = getPatternGridSize(appState);

  // keep the custom input in sync when the scale changes elsewhere (presets, undo)
  useEffect(() => {
    setScaleInput(String(appState.patternGridPixelsPerInch));
  }, [appState.patternGridPixelsPerInch]);

  useEffect(() => {
    setSeamAllowanceInput(String(appState.patternGridSeamAllowanceInches));
  }, [appState.patternGridSeamAllowanceInches]);

  const setPatternGridPixelsPerInch = (value: number) => {
    setAppState({
      patternGridPixelsPerInch: getNormalizedPatternGridPixelsPerInch(value),
    });
  };

  const commitScaleInput = () => {
    const parsed = Number.parseFloat(scaleInput);
    if (Number.isFinite(parsed)) {
      setPatternGridPixelsPerInch(parsed);
    } else {
      setScaleInput(String(appState.patternGridPixelsPerInch));
    }
  };

  const setPatternGridSeamAllowanceInches = (value: number) => {
    setAppState({
      patternGridSeamAllowanceInches:
        getNormalizedPatternGridSeamAllowanceInches(value),
    });
  };

  const commitSeamAllowanceInput = () => {
    const parsed = Number.parseFloat(seamAllowanceInput);
    if (Number.isFinite(parsed)) {
      setPatternGridSeamAllowanceInches(parsed);
    } else {
      setSeamAllowanceInput(String(appState.patternGridSeamAllowanceInches));
    }
  };

  const seamAllowanceDisabled = !appState.patternGridMeasurementsEnabled;

  // Selection summary: finished vs. cut size for a single selected piece.
  let seamAllowanceSummary: string | null = null;
  if (
    appState.patternGridSeamAllowanceEnabled &&
    appState.patternGridMeasurementsEnabled &&
    appState.patternGridSeamAllowanceInches > 0
  ) {
    const selected = elements.filter(
      (element) => appState.selectedElementIds[element.id],
    );

    if (selected.length === 1) {
      const geometry = getSeamAllowanceGeometry(
        selected[0],
        elementsMap,
        appState.patternGridSeamAllowanceInches *
          appState.patternGridPixelsPerInch,
      );

      if (geometry) {
        const { finished, cut } = getSeamAllowanceMeasurements(geometry);
        const ppi = appState.patternGridPixelsPerInch;

        seamAllowanceSummary = `Finished ${formatWidgetInches(
          finished.width,
          ppi,
        )}×${formatWidgetInches(
          finished.height,
          ppi,
        )}" · Cut ${formatWidgetInches(cut.width, ppi)}×${formatWidgetInches(
          cut.height,
          ppi,
        )}"`;
      }
    }
  }

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
          <label className="PatternGridWidget__toggle">
            <span>Edge lengths</span>
            <input
              type="checkbox"
              checked={appState.patternGridEdgeLengthsEnabled}
              disabled={!appState.patternGridMeasurementsEnabled}
              onChange={() =>
                setAppState({
                  patternGridEdgeLengthsEnabled:
                    !appState.patternGridEdgeLengthsEnabled,
                })
              }
            />
          </label>
          <label className="PatternGridWidget__toggle">
            <span>Seam allowance</span>
            <input
              type="checkbox"
              checked={appState.patternGridSeamAllowanceEnabled}
              disabled={seamAllowanceDisabled}
              onChange={() =>
                setAppState({
                  patternGridSeamAllowanceEnabled:
                    !appState.patternGridSeamAllowanceEnabled,
                })
              }
            />
          </label>
          {appState.patternGridSeamAllowanceEnabled && (
            <div className="PatternGridWidget__section">
              <div className="PatternGridWidget__sectionLabel">Allowance</div>
              <div className="PatternGridWidget__segments">
                {PATTERN_GRID_SEAM_ALLOWANCE_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset}
                    disabled={seamAllowanceDisabled}
                    aria-pressed={
                      appState.patternGridSeamAllowanceInches === preset
                    }
                    className={clsx("PatternGridWidget__segment", {
                      "PatternGridWidget__segment--active":
                        appState.patternGridSeamAllowanceInches === preset,
                    })}
                    onClick={() => setPatternGridSeamAllowanceInches(preset)}
                  >
                    {getSeamAllowanceLabel(preset)}
                  </button>
                ))}
              </div>
              <label className="PatternGridWidget__field">
                <span>Custom</span>
                <span className="PatternGridWidget__fieldInput">
                  <input
                    type="number"
                    min={MIN_PATTERN_GRID_SEAM_ALLOWANCE_INCHES}
                    max={MAX_PATTERN_GRID_SEAM_ALLOWANCE_INCHES}
                    step={0.125}
                    disabled={seamAllowanceDisabled}
                    value={seamAllowanceInput}
                    onChange={(event) =>
                      setSeamAllowanceInput(event.target.value)
                    }
                    onBlur={commitSeamAllowanceInput}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                  <span className="PatternGridWidget__fieldSuffix">in</span>
                </span>
              </label>
              {seamAllowanceSummary && (
                <div className="PatternGridWidget__meta">
                  {seamAllowanceSummary}
                </div>
              )}
            </div>
          )}
          <div className="PatternGridWidget__section">
            <div className="PatternGridWidget__sectionLabel">Scale</div>
            <div className="PatternGridWidget__segments PatternGridWidget__segments--four">
              {PATTERN_GRID_PIXELS_PER_INCH_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset}
                  aria-pressed={appState.patternGridPixelsPerInch === preset}
                  className={clsx("PatternGridWidget__segment", {
                    "PatternGridWidget__segment--active":
                      appState.patternGridPixelsPerInch === preset,
                  })}
                  onClick={() => setPatternGridPixelsPerInch(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
            <label className="PatternGridWidget__field">
              <span>Custom</span>
              <span className="PatternGridWidget__fieldInput">
                <input
                  type="number"
                  min={10}
                  max={1000}
                  step={1}
                  value={scaleInput}
                  onChange={(event) => setScaleInput(event.target.value)}
                  onBlur={commitScaleInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                />
                <span className="PatternGridWidget__fieldSuffix">px / in</span>
              </span>
            </label>
          </div>
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
