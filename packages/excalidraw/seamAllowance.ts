import {
  getElementAbsoluteCoords,
  isLineElement,
  LinearElementEditor,
} from "@excalidraw/element";
import {
  line,
  lineSegment,
  linesIntersectAt,
  pointDistance,
  pointFrom,
  pointRotateRads,
  pointsEqual,
  pointTranslate,
  segmentsIntersectAt,
  vectorFromPoint,
  vectorNormal,
  vectorNormalize,
  vectorScale,
  vectorSubtract,
} from "@excalidraw/math";

import type {
  ElementsMap,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { GlobalPoint, Radians } from "@excalidraw/math";

// Beyond this ratio of miter length to allowance, an acute corner is beveled
// instead of spiked out to an arbitrarily far miter point (matches the SVG
// default miter limit).
const MITER_LIMIT = 4;

const EPSILON = 1e-6;

/**
 * Signed area of a closed ring (shoelace). Sign encodes winding; because canvas
 * Y grows downward, a visually clockwise ring has a positive signed area here.
 */
export const getRingSignedArea = (ring: readonly GlobalPoint[]): number => {
  let area = 0;

  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }

  return area / 2;
};

/** Absolute enclosed area of a closed ring. */
export const getRingArea = (ring: readonly GlobalPoint[]): number =>
  Math.abs(getRingSignedArea(ring));

/** Axis-aligned bounding box [x1, y1, x2, y2] of a ring. */
export const getRingBounds = (
  ring: readonly GlobalPoint[],
): [number, number, number, number] => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return [minX, minY, maxX, maxY];
};

/** True if any two non-adjacent edges of the ring cross. */
export const isRingSelfIntersecting = (
  ring: readonly GlobalPoint[],
): boolean => {
  const n = ring.length;

  for (let i = 0; i < n; i++) {
    const a = lineSegment(ring[i], ring[(i + 1) % n]);

    for (let j = i + 1; j < n; j++) {
      // skip edges that share a vertex with edge i (adjacent + wrap-around)
      if ((j + 1) % n === i || (i + 1) % n === j) {
        continue;
      }

      if (
        segmentsIntersectAt(a, lineSegment(ring[j], ring[(j + 1) % n])) != null
      ) {
        return true;
      }
    }
  }

  return false;
};

/** Drop consecutive duplicate vertices so edges never have zero length. */
const dedupeRing = (ring: readonly GlobalPoint[]): GlobalPoint[] => {
  const result: GlobalPoint[] = [];

  for (const point of ring) {
    const previous = result[result.length - 1];
    if (!previous || !pointsEqual(previous, point)) {
      result.push(point);
    }
  }

  // a closed ring may repeat its first point at the end
  if (result.length > 1 && pointsEqual(result[0], result[result.length - 1])) {
    result.pop();
  }

  return result;
};

/**
 * True contour offset of a closed ring: each edge is pushed out along its
 * outward normal by `allowance` and consecutive offset edges are reconnected
 * with a miter join (beveled past the miter limit). Returns `null` when the
 * shape is degenerate or the offset self-intersects (e.g. a shape smaller than
 * the allowance), so the caller can fall back to a bounding-box band.
 */
export const offsetClosedPolygon = (
  inputRing: readonly GlobalPoint[],
  allowance: number,
): GlobalPoint[] | null => {
  if (allowance <= 0) {
    return null;
  }

  const ring = dedupeRing(inputRing);
  const n = ring.length;

  if (n < 3) {
    return null;
  }

  const area = getRingSignedArea(ring);
  if (Math.abs(area) < EPSILON) {
    return null; // collinear / zero-area
  }

  // Outward normal orientation flips with winding. For a positive signed area,
  // vectorNormal(edgeDir) already points outward.
  const orientation = area >= 0 ? 1 : -1;

  // Offset each edge (ring[i] -> ring[i+1]) outward, keeping the shifted line.
  const offsetEdges: [GlobalPoint, GlobalPoint][] = [];

  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const direction = vectorNormalize(
      vectorSubtract(vectorFromPoint(b), vectorFromPoint(a)),
    );
    const shift = vectorScale(
      vectorScale(vectorNormal(direction), orientation),
      allowance,
    );

    offsetEdges.push([pointTranslate(a, shift), pointTranslate(b, shift)]);
  }

  const result: GlobalPoint[] = [];

  for (let i = 0; i < n; i++) {
    const previous = (i - 1 + n) % n;
    const intersection = linesIntersectAt(
      line(offsetEdges[previous][0], offsetEdges[previous][1]),
      line(offsetEdges[i][0], offsetEdges[i][1]),
    );

    if (intersection == null) {
      // parallel edges (straight run) — the offset endpoints coincide
      result.push(offsetEdges[i][0]);
      continue;
    }

    if (pointDistance(ring[i], intersection) > MITER_LIMIT * allowance) {
      // acute corner: bevel across the gap instead of spiking to the miter tip
      result.push(offsetEdges[previous][1]);
      result.push(offsetEdges[i][0]);
    } else {
      result.push(intersection);
    }
  }

  return isRingSelfIntersecting(result) ? null : result;
};

export type SeamAllowanceGeometry =
  | {
      type: "rings";
      finished: GlobalPoint[];
      cut: GlobalPoint[];
      /** true when we fell back to a bounding-box band (offset was unsafe) */
      approximate: boolean;
    }
  | {
      type: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      angle: Radians;
      allowance: number;
    };

const getRotatedRing = (
  element: NonDeletedExcalidrawElement,
  localCorners: readonly (readonly [number, number])[],
): GlobalPoint[] => {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const center = pointFrom<GlobalPoint>(cx, cy);

  return localCorners.map(([lx, ly]) =>
    pointRotateRads(
      pointFrom<GlobalPoint>(cx + lx, cy + ly),
      center,
      element.angle,
    ),
  );
};

const getBoundingBoxBand = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  allowance: number,
): SeamAllowanceGeometry => {
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);

  return {
    type: "rings",
    approximate: true,
    finished: [
      pointFrom<GlobalPoint>(x1, y1),
      pointFrom<GlobalPoint>(x2, y1),
      pointFrom<GlobalPoint>(x2, y2),
      pointFrom<GlobalPoint>(x1, y2),
    ],
    cut: [
      pointFrom<GlobalPoint>(x1 - allowance, y1 - allowance),
      pointFrom<GlobalPoint>(x2 + allowance, y1 - allowance),
      pointFrom<GlobalPoint>(x2 + allowance, y2 + allowance),
      pointFrom<GlobalPoint>(x1 - allowance, y2 + allowance),
    ],
  };
};

const offsetRingOrBand = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  finished: GlobalPoint[],
  allowance: number,
): SeamAllowanceGeometry => {
  const cut = offsetClosedPolygon(finished, allowance);

  return cut
    ? { type: "rings", finished, cut, approximate: false }
    : getBoundingBoxBand(element, elementsMap, allowance);
};

/**
 * Build the seam-allowance geometry (finished + cut outlines) for a single
 * element. `allowance` is in pixels. Returns `null` for element types that have
 * no enclosed piece (text, arrows, open polylines, images, frames, ...).
 */
export const getSeamAllowanceGeometry = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  allowance: number,
): SeamAllowanceGeometry | null => {
  if (allowance <= 0) {
    return null;
  }

  const width = Math.abs(element.width);
  const height = Math.abs(element.height);

  if (element.type === "ellipse") {
    const rx = width / 2;
    const ry = height / 2;

    if (rx <= 0 || ry <= 0) {
      return null;
    }

    return {
      type: "ellipse",
      cx: element.x + element.width / 2,
      cy: element.y + element.height / 2,
      rx,
      ry,
      angle: element.angle,
      allowance,
    };
  }

  if (element.type === "rectangle") {
    if (width <= 0 || height <= 0) {
      return null;
    }

    const w = element.width;
    const h = element.height;

    return offsetRingOrBand(
      element,
      elementsMap,
      getRotatedRing(element, [
        [-w / 2, -h / 2],
        [w / 2, -h / 2],
        [w / 2, h / 2],
        [-w / 2, h / 2],
      ]),
      allowance,
    );
  }

  if (element.type === "diamond") {
    if (width <= 0 || height <= 0) {
      return null;
    }

    const w = element.width;
    const h = element.height;

    return offsetRingOrBand(
      element,
      elementsMap,
      getRotatedRing(element, [
        [0, -h / 2],
        [w / 2, 0],
        [0, h / 2],
        [-w / 2, 0],
      ]),
      allowance,
    );
  }

  // Closed line/polygon pieces. Open polylines have no enclosed area — skip.
  if (isLineElement(element) && element.polygon) {
    const finished = dedupeRing(
      LinearElementEditor.getPointsGlobalCoordinates(element, elementsMap).map(
        (point) => pointFrom<GlobalPoint>(point[0], point[1]),
      ),
    );

    if (finished.length < 3) {
      return null;
    }

    return offsetRingOrBand(element, elementsMap, finished, allowance);
  }

  return null;
};

export type SeamAllowanceMeasurements = {
  finished: { width: number; height: number; area: number };
  cut: { width: number; height: number; area: number };
};

/**
 * Finished (stitch-line) vs. cut (with-allowance) size for a piece: bounding-box
 * W×H plus enclosed area, both in pixels. Divide by pixels-per-inch to display.
 */
export const getSeamAllowanceMeasurements = (
  geometry: SeamAllowanceGeometry,
): SeamAllowanceMeasurements => {
  if (geometry.type === "ellipse") {
    const { rx, ry, allowance } = geometry;

    return {
      finished: {
        width: rx * 2,
        height: ry * 2,
        area: Math.PI * rx * ry,
      },
      cut: {
        width: (rx + allowance) * 2,
        height: (ry + allowance) * 2,
        area: Math.PI * (rx + allowance) * (ry + allowance),
      },
    };
  }

  const [fx1, fy1, fx2, fy2] = getRingBounds(geometry.finished);
  const [cx1, cy1, cx2, cy2] = getRingBounds(geometry.cut);

  return {
    finished: {
      width: fx2 - fx1,
      height: fy2 - fy1,
      area: getRingArea(geometry.finished),
    },
    cut: {
      width: cx2 - cx1,
      height: cy2 - cy1,
      area: getRingArea(geometry.cut),
    },
  };
};
