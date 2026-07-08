import type { AppState } from "./types";

export const DEFAULT_PATTERN_GRID_PIXELS_PER_INCH = 100;
export const DEFAULT_PATTERN_GRID_SUBDIVISIONS = 4;
export const PATTERN_GRID_SUBDIVISIONS = [4, 10] as const;

export const getPatternGridSize = (
  appState: Pick<
    AppState,
    "patternGridPixelsPerInch" | "patternGridSubdivisions"
  >,
) => appState.patternGridPixelsPerInch / appState.patternGridSubdivisions;

export const getNormalizedPatternGridPixelsPerInch = (value: number) => {
  if (!Number.isFinite(value)) {
    return DEFAULT_PATTERN_GRID_PIXELS_PER_INCH;
  }

  return Math.min(Math.max(Math.round(value), 10), 1000);
};

export const getNormalizedPatternGridSubdivisions = (value: number) => {
  if (PATTERN_GRID_SUBDIVISIONS.some((subdivision) => subdivision === value)) {
    return value;
  }

  return DEFAULT_PATTERN_GRID_SUBDIVISIONS;
};
