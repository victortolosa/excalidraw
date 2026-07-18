import type { AppState } from "./types";

export const DEFAULT_PATTERN_GRID_PIXELS_PER_INCH = 100;
export const DEFAULT_PATTERN_GRID_SUBDIVISIONS = 4;
export const PATTERN_GRID_SUBDIVISIONS = [4, 10] as const;
export const PATTERN_GRID_PIXELS_PER_INCH_PRESETS = [25, 50, 100, 200] as const;
export const MIN_PATTERN_GRID_PIXELS_PER_INCH = 10;
export const MAX_PATTERN_GRID_PIXELS_PER_INCH = 1000;

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

  return Math.min(
    Math.max(Math.round(value), MIN_PATTERN_GRID_PIXELS_PER_INCH),
    MAX_PATTERN_GRID_PIXELS_PER_INCH,
  );
};

export const getNormalizedPatternGridSubdivisions = (value: number) => {
  if (PATTERN_GRID_SUBDIVISIONS.some((subdivision) => subdivision === value)) {
    return value;
  }

  return DEFAULT_PATTERN_GRID_SUBDIVISIONS;
};
