import { line, linesIntersectAt } from "./line";
import { pointDistance, pointsEqual, pointTranslate } from "./point";
import {
  vectorFromPoint,
  vectorNormal,
  vectorNormalize,
  vectorScale,
  vectorSubtract,
} from "./vector";

import type { GlobalPoint, LocalPoint } from "./types";

// Beyond this multiple of the offset distance, a miter tip spikes far past the
// corner; bevel across the gap instead.
const OFFSET_MITER_LIMIT = 4;

const dedupe = <Point extends GlobalPoint | LocalPoint>(
  points: readonly Point[],
): Point[] => {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length === 0 || !pointsEqual(out[out.length - 1], p)) {
      out.push(p);
    }
  }
  return out;
};

/**
 * Offset a polyline (or closed polygon) by a signed perpendicular `distance`.
 *
 * Each segment is shifted along its left-hand normal by `distance` (negative
 * flips the side), then consecutive shifted segments are re-joined at their
 * miter intersection, falling back to a bevel on sharp corners. The input
 * points are treated as an open path unless `closed` is true, in which case the
 * last vertex wraps to the first.
 *
 * Returns a new point array of the same length as the (de-duplicated) input.
 * Callers that need a specific inside/outside result should pick the sign of
 * `distance` from the path winding.
 */
export function offsetPolyline<Point extends GlobalPoint | LocalPoint>(
  inputPoints: readonly Point[],
  distance: number,
  closed: boolean,
): Point[] {
  if (distance === 0) {
    return [...inputPoints];
  }

  let pts = dedupe(inputPoints);
  // a closed ring may repeat its first point at the end — drop the duplicate
  if (closed && pts.length > 1 && pointsEqual(pts[0], pts[pts.length - 1])) {
    pts = pts.slice(0, -1);
  }

  const n = pts.length;
  if (n < 2) {
    return [...inputPoints];
  }

  const segmentCount = closed ? n : n - 1;
  const shifted: [Point, Point][] = [];

  for (let i = 0; i < segmentCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const direction = vectorNormalize(
      vectorSubtract(vectorFromPoint(b), vectorFromPoint(a)),
    );
    const shift = vectorScale(vectorNormal(direction), distance);
    shifted.push([pointTranslate(a, shift), pointTranslate(b, shift)]);
  }

  const result: Point[] = [];

  for (let i = 0; i < n; i++) {
    // open-path endpoints keep the raw shifted segment ends (no join)
    if (!closed && i === 0) {
      result.push(shifted[0][0]);
      continue;
    }
    if (!closed && i === n - 1) {
      result.push(shifted[segmentCount - 1][1]);
      continue;
    }

    const prev = closed ? (i - 1 + segmentCount) % segmentCount : i - 1;
    const cur = closed ? i % segmentCount : i;

    const intersection = linesIntersectAt(
      line(shifted[prev][0], shifted[prev][1]),
      line(shifted[cur][0], shifted[cur][1]),
    );

    if (intersection == null) {
      // parallel (straight run) — the shifted endpoints coincide
      result.push(shifted[cur][0]);
      continue;
    }

    if (
      pointDistance(pts[i % n], intersection) >
      OFFSET_MITER_LIMIT * Math.abs(distance)
    ) {
      result.push(shifted[prev][1]);
      result.push(shifted[cur][0]);
    } else {
      result.push(intersection as Point);
    }
  }

  return result;
}
