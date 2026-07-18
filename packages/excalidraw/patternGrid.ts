import type { AppState } from "./types";

export const DEFAULT_PATTERN_GRID_PIXELS_PER_INCH = 100;
export const DEFAULT_PATTERN_GRID_SUBDIVISIONS = 4;
export const PATTERN_GRID_SUBDIVISIONS = [4, 10] as const;
export const PATTERN_GRID_PIXELS_PER_INCH_PRESETS = [25, 50, 100, 200] as const;
export const MIN_PATTERN_GRID_PIXELS_PER_INCH = 10;
export const MAX_PATTERN_GRID_PIXELS_PER_INCH = 1000;

export const DEFAULT_PATTERN_GRID_SEAM_ALLOWANCE_INCHES = 0.5;
export const PATTERN_GRID_SEAM_ALLOWANCE_PRESETS = [0.375, 0.5, 0.625] as const;
export const MIN_PATTERN_GRID_SEAM_ALLOWANCE_INCHES = 0;
export const MAX_PATTERN_GRID_SEAM_ALLOWANCE_INCHES = 12;

// Stroke width expressed as a real-world line thickness in inches (pattern mode
// only). The element still stores strokeWidth in scene pixels; inches are just a
// display/edit unit converted through patternGridPixelsPerInch.
export const PATTERN_GRID_STROKE_WIDTH_PRESETS = [
  0.015625, // 1/64"
  0.03125, // 1/32"
  0.0625, // 1/16"
] as const;
export const MIN_PATTERN_GRID_STROKE_WIDTH_INCHES = 0.005;
// Generous upper bound: guards against absurd/NaN input without clamping real
// values. (Was 0.5", which silently capped anything thicker.)
export const MAX_PATTERN_GRID_STROKE_WIDTH_INCHES = 4;
// A middle-of-the-range fallback, only used when normalizing a non-finite input.
export const DEFAULT_PATTERN_GRID_STROKE_WIDTH_INCHES = 0.03125; // 1/32"

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

export const getNormalizedPatternGridSeamAllowanceInches = (value: number) => {
  if (!Number.isFinite(value)) {
    return DEFAULT_PATTERN_GRID_SEAM_ALLOWANCE_INCHES;
  }

  return Math.min(
    Math.max(value, MIN_PATTERN_GRID_SEAM_ALLOWANCE_INCHES),
    MAX_PATTERN_GRID_SEAM_ALLOWANCE_INCHES,
  );
};

export const getNormalizedPatternGridStrokeWidthInches = (value: number) => {
  if (!Number.isFinite(value)) {
    return DEFAULT_PATTERN_GRID_STROKE_WIDTH_INCHES;
  }

  return Math.min(
    Math.max(value, MIN_PATTERN_GRID_STROKE_WIDTH_INCHES),
    MAX_PATTERN_GRID_STROKE_WIDTH_INCHES,
  );
};

// inches <-> scene-pixel strokeWidth, using the active grid scale.
export const patternGridInchesToStrokeWidth = (
  inches: number,
  pixelsPerInch: number,
) => getNormalizedPatternGridStrokeWidthInches(inches) * pixelsPerInch;

export const patternGridStrokeWidthToInches = (
  strokeWidth: number,
  pixelsPerInch: number,
) => strokeWidth / pixelsPerInch;

export const getNormalizedPatternGridSubdivisions = (value: number) => {
  if (PATTERN_GRID_SUBDIVISIONS.some((subdivision) => subdivision === value)) {
    return value;
  }

  return DEFAULT_PATTERN_GRID_SUBDIVISIONS;
};
