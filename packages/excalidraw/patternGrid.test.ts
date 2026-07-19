import {
  DEFAULT_PATTERN_GRID_STROKE_WIDTH_INCHES,
  MAX_PATTERN_GRID_STROKE_WIDTH_INCHES,
  MIN_PATTERN_GRID_STROKE_WIDTH_INCHES,
  PATTERN_GRID_SEAM_ALLOWANCE_PRESETS,
  getNormalizedPatternGridStrokeWidthInches,
  patternGridInchesToStrokeWidth,
  patternGridStrokeWidthToInches,
} from "./patternGrid";

describe("pattern grid seam allowance", () => {
  it("offers the common quarter-inch through five-eighths presets", () => {
    expect(PATTERN_GRID_SEAM_ALLOWANCE_PRESETS).toEqual([
      0.25, 0.375, 0.5, 0.625,
    ]);
  });
});

describe("pattern grid stroke width (inches)", () => {
  describe("getNormalizedPatternGridStrokeWidthInches", () => {
    it("passes through an in-range value", () => {
      expect(getNormalizedPatternGridStrokeWidthInches(0.0625)).toBe(0.0625);
    });

    it("clamps below the minimum", () => {
      expect(getNormalizedPatternGridStrokeWidthInches(0)).toBe(
        MIN_PATTERN_GRID_STROKE_WIDTH_INCHES,
      );
      expect(getNormalizedPatternGridStrokeWidthInches(-5)).toBe(
        MIN_PATTERN_GRID_STROKE_WIDTH_INCHES,
      );
    });

    it("clamps above the maximum", () => {
      expect(getNormalizedPatternGridStrokeWidthInches(999)).toBe(
        MAX_PATTERN_GRID_STROKE_WIDTH_INCHES,
      );
    });

    it("falls back to the default for non-finite input", () => {
      expect(getNormalizedPatternGridStrokeWidthInches(NaN)).toBe(
        DEFAULT_PATTERN_GRID_STROKE_WIDTH_INCHES,
      );
      expect(getNormalizedPatternGridStrokeWidthInches(Infinity)).toBe(
        DEFAULT_PATTERN_GRID_STROKE_WIDTH_INCHES,
      );
    });
  });

  describe("inches <-> strokeWidth conversion", () => {
    it("converts inches to scene pixels at the active scale", () => {
      // 1/16" at 100 px/in => 6.25 scene px
      expect(patternGridInchesToStrokeWidth(0.0625, 100)).toBe(6.25);
      // scale changes the pixel result
      expect(patternGridInchesToStrokeWidth(0.0625, 200)).toBe(12.5);
    });

    it("clamps the inch value before converting", () => {
      expect(patternGridInchesToStrokeWidth(0, 100)).toBe(
        MIN_PATTERN_GRID_STROKE_WIDTH_INCHES * 100,
      );
    });

    it("round-trips through pixels and back", () => {
      const inches = 0.03125;
      const px = patternGridInchesToStrokeWidth(inches, 100);
      expect(patternGridStrokeWidthToInches(px, 100)).toBeCloseTo(inches, 6);
    });
  });
});
