import { offsetPolyline } from "../src/offset";
import { pointFrom } from "../src/point";

import type { LocalPoint } from "../src/types";

const p = (x: number, y: number) => pointFrom<LocalPoint>(x, y);

describe("offsetPolyline", () => {
  it("returns a copy when distance is 0", () => {
    const pts = [p(0, 0), p(10, 0)];
    const out = offsetPolyline(pts, 0, false);
    expect(out).toEqual(pts);
    expect(out).not.toBe(pts);
  });

  it("shifts an open horizontal segment along its normal", () => {
    // segment left->right; left-hand normal of (1,0) is (0,-1) => shift up by d
    const out = offsetPolyline([p(0, 0), p(10, 0)], 2, false);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(p(0, -2));
    expect(out[1]).toEqual(p(10, -2));
  });

  it("flips the side with a negative distance", () => {
    const out = offsetPolyline([p(0, 0), p(10, 0)], -2, false);
    expect(out[0]).toEqual(p(0, 2));
    expect(out[1]).toEqual(p(10, 2));
  });

  it("miters an open right-angle corner", () => {
    // path down the y-axis then right along x; offset by 2.
    // seg0 (0,0)->(0,10) shifts +x to x=2; seg1 (0,10)->(10,10) shifts -y to
    // y=8; the corner joins at their intersection (2, 8).
    const out = offsetPolyline([p(0, 0), p(0, 10), p(10, 10)], 2, false);
    expect(out).toHaveLength(3);
    expect(out[1][0]).toBeCloseTo(2, 6);
    expect(out[1][1]).toBeCloseTo(8, 6);
  });

  it("offsets a closed square outward and preserves vertex count", () => {
    // CCW square (positive normal points outward for this winding)
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    const out = offsetPolyline(square, 2, true);
    expect(out).toHaveLength(4);
    // outward-offset square should be larger, centered on the same midpoint
    const xs = out.map((q) => q[0]);
    const ys = out.map((q) => q[1]);
    expect(Math.min(...xs)).toBeCloseTo(-2, 6);
    expect(Math.max(...xs)).toBeCloseTo(12, 6);
    expect(Math.min(...ys)).toBeCloseTo(-2, 6);
    expect(Math.max(...ys)).toBeCloseTo(12, 6);
  });

  it("drops a duplicated closing vertex on a closed ring", () => {
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10), p(0, 0)];
    const out = offsetPolyline(square, 2, true);
    expect(out).toHaveLength(4);
  });
});
