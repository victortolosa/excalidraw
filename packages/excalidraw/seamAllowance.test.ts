import { pointFrom } from "@excalidraw/math";

import type { GlobalPoint, Radians } from "@excalidraw/math";

import {
  getRingArea,
  getRingBounds,
  getRingSignedArea,
  getSeamAllowanceMeasurements,
  isRingSelfIntersecting,
  offsetClosedPolygon,
  type SeamAllowanceGeometry,
} from "./seamAllowance";

const ring = (...coords: [number, number][]): GlobalPoint[] =>
  coords.map(([x, y]) => pointFrom<GlobalPoint>(x, y));

// axis-aligned square, vertices in visually-clockwise order
const square = ring([0, 0], [10, 0], [10, 10], [0, 10]);

describe("ring helpers", () => {
  it("computes absolute area regardless of winding", () => {
    expect(getRingArea(square)).toBeCloseTo(100);
    // reversed winding → opposite sign, same absolute area
    expect(getRingSignedArea(square)).toBeCloseTo(
      -getRingSignedArea([...square].reverse()),
    );
  });

  it("computes bounds", () => {
    expect(getRingBounds(square)).toEqual([0, 0, 10, 10]);
  });

  it("detects self-intersection (bowtie) but not a simple polygon", () => {
    expect(isRingSelfIntersecting(square)).toBe(false);
    const bowtie = ring([0, 0], [10, 0], [0, 10], [10, 10]);
    expect(isRingSelfIntersecting(bowtie)).toBe(true);
  });
});

describe("offsetClosedPolygon", () => {
  it("grows a square by the exact allowance on every side", () => {
    const offset = offsetClosedPolygon(square, 2);
    expect(offset).not.toBeNull();
    expect(getRingBounds(offset!)).toEqual([-2, -2, 12, 12]);
  });

  it("offsets outward regardless of vertex winding", () => {
    const offset = offsetClosedPolygon([...square].reverse(), 2);
    expect(offset).not.toBeNull();
    expect(getRingBounds(offset!)).toEqual([-2, -2, 12, 12]);
  });

  it("grows a triangle outward", () => {
    const triangle = ring([0, 0], [10, 0], [5, 10]);
    const offset = offsetClosedPolygon(triangle, 1);
    expect(offset).not.toBeNull();

    const [minX, minY, maxX, maxY] = getRingBounds(offset!);
    // bounds strictly expand in every direction
    expect(minX).toBeLessThan(0);
    expect(minY).toBeLessThan(0);
    expect(maxX).toBeGreaterThan(10);
    expect(maxY).toBeGreaterThan(10);
  });

  it("returns null when the offset self-intersects (narrow concave notch)", () => {
    // a square with a 2-wide slot cut into the top edge (concave)
    const notched = ring(
      [0, 0],
      [4, 0],
      [4, 4],
      [6, 4],
      [6, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    );
    // small allowance keeps the slot open → valid offset
    expect(offsetClosedPolygon(notched, 0.5)).not.toBeNull();
    // allowance wider than half the 2-wide slot → walls cross → fall back
    expect(offsetClosedPolygon(notched, 2)).toBeNull();
  });

  it("returns null for degenerate input", () => {
    expect(offsetClosedPolygon(ring([0, 0], [10, 0]), 2)).toBeNull();
    expect(offsetClosedPolygon(square, 0)).toBeNull();
    // collinear points enclose no area
    expect(offsetClosedPolygon(ring([0, 0], [5, 0], [10, 0]), 2)).toBeNull();
  });
});

describe("getSeamAllowanceMeasurements", () => {
  it("reports finished vs. cut size for a ring band", () => {
    const geometry: SeamAllowanceGeometry = {
      type: "rings",
      approximate: false,
      finished: square,
      cut: offsetClosedPolygon(square, 2)!,
    };

    const { finished, cut } = getSeamAllowanceMeasurements(geometry);
    expect(finished).toEqual({ width: 10, height: 10, area: 100 });
    expect(cut).toEqual({ width: 14, height: 14, area: 196 });
  });

  it("reports finished vs. cut size for an ellipse (radii + allowance)", () => {
    const geometry: SeamAllowanceGeometry = {
      type: "ellipse",
      cx: 0,
      cy: 0,
      rx: 5,
      ry: 3,
      angle: 0 as Radians,
      allowance: 1,
    };

    const { finished, cut } = getSeamAllowanceMeasurements(geometry);
    expect(finished.width).toBeCloseTo(10);
    expect(finished.height).toBeCloseTo(6);
    expect(finished.area).toBeCloseTo(Math.PI * 5 * 3);
    expect(cut.width).toBeCloseTo(12);
    expect(cut.height).toBeCloseTo(8);
    expect(cut.area).toBeCloseTo(Math.PI * 6 * 4);
  });
});
