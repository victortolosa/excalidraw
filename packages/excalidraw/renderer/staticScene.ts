import {
  applyDarkModeFilter,
  COLOR_WHITE,
  FRAME_STYLE,
  THEME,
  throttleRAF,
} from "@excalidraw/common";
import { isElementLink } from "@excalidraw/element";
import { createPlaceholderEmbeddableLabel } from "@excalidraw/element";
import { getBoundTextElement } from "@excalidraw/element";
import {
  isEmbeddableElement,
  isFreeDrawElement,
  isIframeLikeElement,
  isLinearElement,
  isLineElement,
  isTextElement,
  LinearElementEditor,
} from "@excalidraw/element";
import { pointDistance } from "@excalidraw/math";
import {
  elementOverlapsWithFrame,
  getTargetFrame,
  shouldApplyFrameClip,
} from "@excalidraw/element";

import { renderElement } from "@excalidraw/element";

import { getElementAbsoluteCoords } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawFrameLikeElement,
  ExcalidrawLinearElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { GlobalPoint } from "@excalidraw/math";

import {
  EXTERNAL_LINK_IMG,
  ELEMENT_LINK_IMG,
  getLinkHandleFromCoords,
} from "../components/hyperlink/helpers";

import { getPatternGridSize } from "../patternGrid";

import {
  getSeamAllowanceGeometry,
  getSeamAllowanceMeasurements,
} from "../seamAllowance";

import { bootstrapCanvas, getNormalizedCanvasDimensions } from "./helpers";

import type { SeamAllowanceGeometry } from "../seamAllowance";

import type {
  StaticCanvasRenderConfig,
  StaticSceneRenderConfig,
} from "../scene/types";
import type { StaticCanvasAppState, Zoom } from "../types";

const GridLineColor = {
  [THEME.LIGHT]: {
    bold: "#dddddd",
    regular: "#e5e5e5",
    label: "#5f6368",
    labelBackground: "rgba(255, 255, 255, 0.82)",
  },
  [THEME.DARK]: {
    bold: applyDarkModeFilter("#dddddd"),
    regular: applyDarkModeFilter("#e5e5e5"),
    label: applyDarkModeFilter("#5f6368"),
    labelBackground: "rgba(35, 35, 35, 0.82)",
  },
} as const;

// Seam-allowance band (between the finished/stitch line and the cut line) plus
// the dashed cut-line outline. `approximateBand` is the fainter fill used when
// we fall back to a bounding-box band.
const SeamAllowanceColor = {
  [THEME.LIGHT]: {
    band: "rgba(25, 113, 194, 0.12)",
    approximateBand: "rgba(95, 99, 104, 0.10)",
    cut: "#1971c2",
    approximateCut: "#5f6368",
  },
  [THEME.DARK]: {
    band: "rgba(102, 170, 255, 0.14)",
    approximateBand: "rgba(200, 200, 200, 0.10)",
    cut: applyDarkModeFilter("#1971c2"),
    approximateCut: applyDarkModeFilter("#5f6368"),
  },
} as const;

const strokeGrid = (
  context: CanvasRenderingContext2D,
  /** grid cell pixel size */
  gridSize: number,
  /** setting to 1 will disble bold lines */
  gridStep: number,
  scrollX: number,
  scrollY: number,
  zoom: Zoom,
  theme: StaticCanvasRenderConfig["theme"],
  width: number,
  height: number,
) => {
  const offsetX = (scrollX % gridSize) - gridSize;
  const offsetY = (scrollY % gridSize) - gridSize;

  const actualGridSize = gridSize * zoom.value;

  const spaceWidth = 1 / zoom.value;

  context.save();

  // Offset rendering by 0.5 to ensure that 1px wide lines are crisp.
  // We only do this when zoomed to 100% because otherwise the offset is
  // fractional, and also visibly offsets the elements.
  // We also do this per-axis, as each axis may already be offset by 0.5.
  if (zoom.value === 1) {
    context.translate(offsetX % 1 ? 0 : 0.5, offsetY % 1 ? 0 : 0.5);
  }

  // vertical lines
  for (let x = offsetX; x < offsetX + width + gridSize * 2; x += gridSize) {
    const isBold =
      gridStep > 1 && Math.round(x - scrollX) % (gridStep * gridSize) === 0;
    // don't render regular lines when zoomed out and they're barely visible
    if (!isBold && actualGridSize < 10) {
      continue;
    }

    const lineWidth = Math.min(1 / zoom.value, isBold ? 4 : 1);
    context.lineWidth = lineWidth;
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.setLineDash(isBold ? [] : lineDash);
    context.strokeStyle = isBold
      ? GridLineColor[theme].bold
      : GridLineColor[theme].regular;
    context.moveTo(x, offsetY - gridSize);
    context.lineTo(x, Math.ceil(offsetY + height + gridSize * 2));
    context.stroke();
  }

  for (let y = offsetY; y < offsetY + height + gridSize * 2; y += gridSize) {
    const isBold =
      gridStep > 1 && Math.round(y - scrollY) % (gridStep * gridSize) === 0;
    if (!isBold && actualGridSize < 10) {
      continue;
    }

    const lineWidth = Math.min(1 / zoom.value, isBold ? 4 : 1);
    context.lineWidth = lineWidth;
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.setLineDash(isBold ? [] : lineDash);
    context.strokeStyle = isBold
      ? GridLineColor[theme].bold
      : GridLineColor[theme].regular;
    context.moveTo(offsetX - gridSize, y);
    context.lineTo(Math.ceil(offsetX + width + gridSize * 2), y);
    context.stroke();
  }
  context.restore();
};

const formatPatternGridLabel = (position: number, pixelsPerInch: number) => {
  const value = position / pixelsPerInch;

  return Number.isInteger(value) ? `${value}"` : `${value.toFixed(1)}"`;
};

const drawPatternGridLabel = (
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  zoom: Zoom,
  theme: StaticCanvasRenderConfig["theme"],
) => {
  const paddingX = 4 / zoom.value;
  const paddingY = 2 / zoom.value;
  const metrics = context.measureText(label);
  const width = metrics.width + paddingX * 2;
  const height = 15 / zoom.value;

  context.fillStyle = GridLineColor[theme].labelBackground;
  context.fillRect(x - paddingX, y - paddingY, width, height);
  context.fillStyle = GridLineColor[theme].label;
  context.fillText(label, x, y);
};

const getPolylineLength = (points: readonly (readonly [number, number])[]) => {
  let length = 0;

  for (let index = 1; index < points.length; index++) {
    const previousPoint = points[index - 1];
    const point = points[index];
    length += Math.hypot(
      point[0] - previousPoint[0],
      point[1] - previousPoint[1],
    );
  }

  return length;
};

type ElementMeasurement = {
  label: "L" | "P" | "W" | "H";
  value: number;
};

const getElementMeasurements = (
  element: NonDeletedExcalidrawElement,
): ElementMeasurement[] => {
  if (isLinearElement(element) || isFreeDrawElement(element)) {
    const length = getPolylineLength(element.points);

    return length > 0 ? [{ label: "L", value: length }] : [];
  }

  const width = Math.abs(element.width);
  const height = Math.abs(element.height);

  if (width <= 0 || height <= 0) {
    return [];
  }

  if (element.type === "rectangle") {
    return [
      { label: "W", value: width },
      { label: "H", value: height },
    ];
  }

  if (element.type === "diamond") {
    return [{ label: "P", value: 2 * Math.hypot(width, height) }];
  }

  if (element.type === "ellipse") {
    const a = width / 2;
    const b = height / 2;

    return [
      {
        label: "P",
        value: Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))),
      },
    ];
  }

  return [];
};

const formatInches = (value: number, pixelsPerInch: number) => {
  const inches = value / pixelsPerInch;
  const rounded = Math.round(inches * 10) / 10;
  const formatted = Number.isInteger(rounded)
    ? `${rounded}`
    : rounded.toFixed(1);

  return `${formatted}"`;
};

const formatMeasurementValue = (
  measurement: ElementMeasurement,
  pixelsPerInch: number,
) => `${measurement.label} ${formatInches(measurement.value, pixelsPerInch)}`;

const drawMeasurementLabel = (
  context: CanvasRenderingContext2D,
  labels: readonly string[],
  x: number,
  y: number,
  zoom: Zoom,
  theme: StaticCanvasRenderConfig["theme"],
) => {
  const paddingX = 6 / zoom.value;
  const paddingY = 3 / zoom.value;
  const lineHeight = 14 / zoom.value;
  const metrics = labels.map((label) => context.measureText(label));
  const width =
    Math.max(...metrics.map((metric) => metric.width)) + paddingX * 2;
  const height = labels.length * lineHeight + paddingY * 2;
  const top = y - height / 2;

  context.fillStyle = GridLineColor[theme].labelBackground;
  context.fillRect(x - width / 2, y - height / 2, width, height);
  context.strokeStyle = GridLineColor[theme].bold;
  context.lineWidth = 1 / zoom.value;
  context.strokeRect(x - width / 2, y - height / 2, width, height);
  context.fillStyle = GridLineColor[theme].label;

  labels.forEach((label, index) => {
    context.fillText(
      label,
      x - metrics[index].width / 2,
      top + paddingY + lineHeight * (index + 0.5),
    );
  });
};

const getElementsBounds = (
  elements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const element of elements) {
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  }

  return Number.isFinite(minX) &&
    Number.isFinite(minY) &&
    Number.isFinite(maxX) &&
    Number.isFinite(maxY)
    ? [minX, minY, maxX, maxY]
    : null;
};

const getBoxMeasurementLabels = (
  title: string,
  width: number,
  height: number,
  pixelsPerInch: number,
) => [
  title,
  formatMeasurementValue({ label: "W", value: width }, pixelsPerInch),
  formatMeasurementValue({ label: "H", value: height }, pixelsPerInch),
];

// Minimum on-screen length (px) an edge must have to get its own length label —
// keeps short/dense segments from overlapping. Zoom-aware, so labels naturally
// drop out as you zoom out rather than needing a hard zoom gate.
const MIN_EDGE_LABEL_SCREEN_PX = 24;

// Per-edge length labels for line/polygon elements (pattern seams). Replaces the
// single total-length ("L") label for these elements when enabled. Freedraw and
// arrows are intentionally excluded (see the caller).
const renderEdgeLengthLabels = (
  context: CanvasRenderingContext2D,
  element: NonDeleted<ExcalidrawLinearElement>,
  elementsMap: ElementsMap,
  appState: StaticCanvasAppState,
  theme: StaticCanvasRenderConfig["theme"],
) => {
  const points = LinearElementEditor.getPointsGlobalCoordinates(
    element,
    elementsMap,
  );

  // A closed polygon stores its closing edge as an explicit final point pair
  // (points[0] === points[last]), so iterating consecutive pairs measures every
  // edge — including the closing one — with no special-casing.
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const length = pointDistance(start, end);

    if (length * appState.zoom.value < MIN_EDGE_LABEL_SCREEN_PX) {
      continue;
    }

    drawMeasurementLabel(
      context,
      [formatInches(length, appState.patternGridPixelsPerInch)],
      (start[0] + end[0]) / 2 + appState.scrollX,
      (start[1] + end[1]) / 2 + appState.scrollY,
      appState.zoom,
      theme,
    );
  }
};

const isSeamAllowanceEnabled = (appState: StaticCanvasAppState) =>
  appState.patternGridModeEnabled &&
  appState.patternGridMeasurementsEnabled &&
  appState.patternGridSeamAllowanceEnabled &&
  appState.patternGridSeamAllowanceInches > 0;

const getSeamAllowancePx = (appState: StaticCanvasAppState) =>
  appState.patternGridSeamAllowanceInches * appState.patternGridPixelsPerInch;

const traceRing = (
  context: CanvasRenderingContext2D,
  ring: readonly GlobalPoint[],
  scrollX: number,
  scrollY: number,
) => {
  ring.forEach((point, index) => {
    const x = point[0] + scrollX;
    const y = point[1] + scrollY;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.closePath();
};

// Adds the seam-allowance outline(s) to the current path. `which` = "both"
// traces the finished + cut rings (for the even-odd band fill); "cut" traces
// only the cut ring (for the dashed cut line).
const traceSeamPaths = (
  context: CanvasRenderingContext2D,
  geometry: SeamAllowanceGeometry,
  scrollX: number,
  scrollY: number,
  which: "both" | "cut",
) => {
  if (geometry.type === "ellipse") {
    const { cx, cy, rx, ry, angle, allowance } = geometry;
    if (which === "both") {
      context.ellipse(
        cx + scrollX,
        cy + scrollY,
        rx,
        ry,
        angle,
        0,
        Math.PI * 2,
      );
    }
    context.ellipse(
      cx + scrollX,
      cy + scrollY,
      rx + allowance,
      ry + allowance,
      angle,
      0,
      Math.PI * 2,
    );
    return;
  }

  if (which === "both") {
    traceRing(context, geometry.finished, scrollX, scrollY);
  }
  traceRing(context, geometry.cut, scrollX, scrollY);
};

// Seam-allowance band + dashed cut line for every eligible visible piece.
// Drawn beneath the elements so each piece's own stroke reads as the finished
// (stitch) line. Shown for all pieces regardless of selection.
const renderSeamAllowance = (
  context: CanvasRenderingContext2D,
  visibleElements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
  appState: StaticCanvasAppState,
  theme: StaticCanvasRenderConfig["theme"],
) => {
  if (!isSeamAllowanceEnabled(appState)) {
    return;
  }

  const allowance = getSeamAllowancePx(appState);
  const colors = SeamAllowanceColor[theme];

  context.save();

  for (const element of visibleElements) {
    const geometry = getSeamAllowanceGeometry(element, elementsMap, allowance);
    if (!geometry) {
      continue;
    }

    const approximate = geometry.type === "rings" && geometry.approximate;

    // band fill (even-odd between finished + cut outlines)
    context.beginPath();
    traceSeamPaths(
      context,
      geometry,
      appState.scrollX,
      appState.scrollY,
      "both",
    );
    context.fillStyle = approximate ? colors.approximateBand : colors.band;
    context.fill("evenodd");

    // dashed cut line
    context.beginPath();
    traceSeamPaths(
      context,
      geometry,
      appState.scrollX,
      appState.scrollY,
      "cut",
    );
    context.strokeStyle = approximate ? colors.approximateCut : colors.cut;
    context.lineWidth = 1 / appState.zoom.value;
    context.setLineDash(
      approximate
        ? [2 / appState.zoom.value, 3 / appState.zoom.value]
        : [6 / appState.zoom.value, 4 / appState.zoom.value],
    );
    context.stroke();
  }

  context.restore();
};

const renderMeasurementLabels = (
  context: CanvasRenderingContext2D,
  visibleElements: readonly NonDeletedExcalidrawElement[],
  elementsMap: ElementsMap,
  appState: StaticCanvasAppState,
  theme: StaticCanvasRenderConfig["theme"],
) => {
  if (
    !appState.patternGridModeEnabled ||
    !appState.patternGridMeasurementsEnabled
  ) {
    return;
  }

  context.save();
  context.setLineDash([]);
  context.font = `${12 / appState.zoom.value}px sans-serif`;
  context.textBaseline = "middle";

  const selectedElements = visibleElements.filter(
    (element) =>
      appState.selectedElementIds[element.id] && !isIframeLikeElement(element),
  );
  const selectedGroupCount = Object.values(appState.selectedGroupIds).filter(
    Boolean,
  ).length;
  const shouldShowSelectionMeasurement =
    selectedGroupCount > 0 || selectedElements.length > 1;

  if (shouldShowSelectionMeasurement) {
    const bounds = getElementsBounds(selectedElements, elementsMap);

    if (bounds) {
      const [x1, y1, x2, y2] = bounds;
      drawMeasurementLabel(
        context,
        getBoxMeasurementLabels(
          selectedGroupCount === 1 ? "Group" : "Selection",
          x2 - x1,
          y2 - y1,
          appState.patternGridPixelsPerInch,
        ),
        (x1 + x2) / 2 + appState.scrollX,
        (y1 + y2) / 2 + appState.scrollY,
        appState.zoom,
        theme,
      );
    }
  }

  for (const element of visibleElements) {
    if (
      appState.patternGridMeasurementsSelectedOnly &&
      !appState.selectedElementIds[element.id]
    ) {
      continue;
    }

    if (
      shouldShowSelectionMeasurement &&
      appState.selectedElementIds[element.id]
    ) {
      continue;
    }

    if (isTextElement(element) || isIframeLikeElement(element)) {
      continue;
    }

    // Line/polygon elements: show a length label on each edge instead of the
    // single total-length label.
    if (appState.patternGridEdgeLengthsEnabled && isLineElement(element)) {
      renderEdgeLengthLabels(context, element, elementsMap, appState, theme);
    }

    // Seam allowance on: replace the standard size label with finished vs. cut
    // dimensions for eligible pieces.
    if (isSeamAllowanceEnabled(appState)) {
      const geometry = getSeamAllowanceGeometry(
        element,
        elementsMap,
        getSeamAllowancePx(appState),
      );

      if (geometry) {
        const { finished, cut } = getSeamAllowanceMeasurements(geometry);
        const ppi = appState.patternGridPixelsPerInch;
        const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);

        drawMeasurementLabel(
          context,
          [
            `Finished ${formatInches(finished.width, ppi)} × ${formatInches(
              finished.height,
              ppi,
            )}`,
            `Cut ${formatInches(cut.width, ppi)} × ${formatInches(
              cut.height,
              ppi,
            )}`,
          ],
          (x1 + x2) / 2 + appState.scrollX,
          (y1 + y2) / 2 + appState.scrollY,
          appState.zoom,
          theme,
        );
        continue;
      }
    }

    // Per-edge labels already drawn above; skip the single total-length label.
    if (appState.patternGridEdgeLengthsEnabled && isLineElement(element)) {
      continue;
    }

    const measurements = getElementMeasurements(element);
    if (!measurements.length) {
      continue;
    }

    const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
    drawMeasurementLabel(
      context,
      measurements.map((measurement) =>
        formatMeasurementValue(measurement, appState.patternGridPixelsPerInch),
      ),
      (x1 + x2) / 2 + appState.scrollX,
      (y1 + y2) / 2 + appState.scrollY,
      appState.zoom,
      theme,
    );
  }

  context.restore();
};

const strokePatternGrid = (
  context: CanvasRenderingContext2D,
  appState: StaticCanvasAppState,
  theme: StaticCanvasRenderConfig["theme"],
  width: number,
  height: number,
) => {
  const { scrollX, scrollY, zoom } = appState;
  const gridSize = getPatternGridSize(appState);
  const majorGridSize = appState.patternGridPixelsPerInch;
  const offsetX = (scrollX % gridSize) - gridSize;
  const offsetY = (scrollY % gridSize) - gridSize;
  const actualGridSize = gridSize * zoom.value;
  const spaceWidth = 1 / zoom.value;

  context.save();

  if (zoom.value === 1) {
    context.translate(offsetX % 1 ? 0 : 0.5, offsetY % 1 ? 0 : 0.5);
  }

  for (let x = offsetX; x < offsetX + width + gridSize * 2; x += gridSize) {
    const gridPosition = x - scrollX;
    const isMajor =
      Math.abs(
        Math.round(gridPosition / majorGridSize) * majorGridSize - gridPosition,
      ) < 0.001;

    if (!isMajor && actualGridSize < 8) {
      continue;
    }

    const lineWidth = Math.min(1 / zoom.value, isMajor ? 3 : 1);
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.lineWidth = lineWidth;
    context.setLineDash(isMajor ? [] : lineDash);
    context.strokeStyle = isMajor
      ? GridLineColor[theme].bold
      : GridLineColor[theme].regular;
    context.moveTo(x, offsetY - gridSize);
    context.lineTo(x, Math.ceil(offsetY + height + gridSize * 2));
    context.stroke();
  }

  for (let y = offsetY; y < offsetY + height + gridSize * 2; y += gridSize) {
    const gridPosition = y - scrollY;
    const isMajor =
      Math.abs(
        Math.round(gridPosition / majorGridSize) * majorGridSize - gridPosition,
      ) < 0.001;

    if (!isMajor && actualGridSize < 8) {
      continue;
    }

    const lineWidth = Math.min(1 / zoom.value, isMajor ? 3 : 1);
    const lineDash = [lineWidth * 3, spaceWidth + (lineWidth + spaceWidth)];

    context.beginPath();
    context.lineWidth = lineWidth;
    context.setLineDash(isMajor ? [] : lineDash);
    context.strokeStyle = isMajor
      ? GridLineColor[theme].bold
      : GridLineColor[theme].regular;
    context.moveTo(offsetX - gridSize, y);
    context.lineTo(Math.ceil(offsetX + width + gridSize * 2), y);
    context.stroke();
  }

  if (appState.patternGridLabelsEnabled && zoom.value >= 0.25) {
    context.setLineDash([]);
    context.font = `${11 / zoom.value}px sans-serif`;
    context.textBaseline = "top";

    const labelInset = 8 / zoom.value;

    for (let x = offsetX; x < offsetX + width + gridSize * 2; x += gridSize) {
      const gridPosition = x - scrollX;
      const isMajor =
        Math.abs(
          Math.round(gridPosition / majorGridSize) * majorGridSize -
            gridPosition,
        ) < 0.001;

      if (!isMajor || x < labelInset) {
        continue;
      }

      drawPatternGridLabel(
        context,
        formatPatternGridLabel(gridPosition, majorGridSize),
        x + 4 / zoom.value,
        labelInset,
        zoom,
        theme,
      );
    }

    for (let y = offsetY; y < offsetY + height + gridSize * 2; y += gridSize) {
      const gridPosition = y - scrollY;
      const isMajor =
        Math.abs(
          Math.round(gridPosition / majorGridSize) * majorGridSize -
            gridPosition,
        ) < 0.001;

      if (!isMajor || y < labelInset) {
        continue;
      }

      drawPatternGridLabel(
        context,
        formatPatternGridLabel(gridPosition, majorGridSize),
        labelInset,
        y + 4 / zoom.value,
        zoom,
        theme,
      );
    }
  }

  context.restore();
};

export const frameClip = (
  frame: ExcalidrawFrameLikeElement,
  context: CanvasRenderingContext2D,
  renderConfig: StaticCanvasRenderConfig,
  appState: StaticCanvasAppState,
) => {
  context.translate(frame.x + appState.scrollX, frame.y + appState.scrollY);
  context.beginPath();
  if (context.roundRect) {
    context.roundRect(
      0,
      0,
      frame.width,
      frame.height,
      FRAME_STYLE.radius / appState.zoom.value,
    );
  } else {
    context.rect(0, 0, frame.width, frame.height);
  }
  context.clip();
  context.translate(
    -(frame.x + appState.scrollX),
    -(frame.y + appState.scrollY),
  );
};

type LinkIconCanvas = HTMLCanvasElement & { zoom: number };

const linkIconCanvasCache: {
  regularLink: LinkIconCanvas | null;
  elementLink: LinkIconCanvas | null;
} = {
  regularLink: null,
  elementLink: null,
};

const renderLinkIcon = (
  element: NonDeletedExcalidrawElement,
  context: CanvasRenderingContext2D,
  appState: StaticCanvasAppState,
  elementsMap: ElementsMap,
) => {
  if (element.link && !appState.selectedElementIds[element.id]) {
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
    const [x, y, width, height] = getLinkHandleFromCoords(
      [x1, y1, x2, y2],
      element.angle,
      appState,
    );
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    context.save();
    context.translate(appState.scrollX + centerX, appState.scrollY + centerY);
    context.rotate(element.angle);

    const canvasKey = isElementLink(element.link)
      ? "elementLink"
      : "regularLink";

    let linkCanvas = linkIconCanvasCache[canvasKey];

    if (!linkCanvas || linkCanvas.zoom !== appState.zoom.value) {
      linkCanvas = Object.assign(document.createElement("canvas"), {
        zoom: appState.zoom.value,
      });
      linkCanvas.width = width * window.devicePixelRatio * appState.zoom.value;
      linkCanvas.height =
        height * window.devicePixelRatio * appState.zoom.value;
      linkIconCanvasCache[canvasKey] = linkCanvas;

      const linkCanvasCacheContext = linkCanvas.getContext("2d")!;
      linkCanvasCacheContext.scale(
        window.devicePixelRatio * appState.zoom.value,
        window.devicePixelRatio * appState.zoom.value,
      );

      // Seed a sane default so a corrupted color (silently rejected by the
      // canvas) falls back to white instead of a stale fillStyle.
      linkCanvasCacheContext.fillStyle = COLOR_WHITE;
      linkCanvasCacheContext.fillStyle =
        appState.viewBackgroundColor || COLOR_WHITE;

      linkCanvasCacheContext.fillRect(0, 0, width, height);

      if (canvasKey === "elementLink") {
        linkCanvasCacheContext.drawImage(ELEMENT_LINK_IMG, 0, 0, width, height);
      } else {
        linkCanvasCacheContext.drawImage(
          EXTERNAL_LINK_IMG,
          0,
          0,
          width,
          height,
        );
      }

      linkCanvasCacheContext.restore();
    }
    context.globalAlpha = element.opacity / 100;
    context.drawImage(linkCanvas, x - centerX, y - centerY, width, height);
    context.restore();
  }
};
const _renderStaticScene = ({
  canvas,
  rc,
  elementsMap,
  allElementsMap,
  visibleElements,
  scale,
  appState,
  renderConfig,
}: StaticSceneRenderConfig) => {
  if (canvas === null) {
    return;
  }

  const { renderGrid = true, isExporting } = renderConfig;

  const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
    canvas,
    scale,
  );

  const context = bootstrapCanvas({
    canvas,
    scale,
    normalizedWidth,
    normalizedHeight,
    theme: appState.theme,
    isExporting,
    viewBackgroundColor: appState.viewBackgroundColor,
  });

  // Apply zoom
  context.scale(appState.zoom.value, appState.zoom.value);

  // Grid
  if (renderGrid) {
    if (appState.patternGridModeEnabled) {
      strokePatternGrid(
        context,
        appState,
        renderConfig.theme,
        normalizedWidth / appState.zoom.value,
        normalizedHeight / appState.zoom.value,
      );
    } else {
      strokeGrid(
        context,
        appState.gridSize,
        appState.gridStep,
        appState.scrollX,
        appState.scrollY,
        appState.zoom,
        renderConfig.theme,
        normalizedWidth / appState.zoom.value,
        normalizedHeight / appState.zoom.value,
      );
    }
  }

  // Seam-allowance band + cut line render beneath the pieces (drawn shape = the
  // finished/stitch line), so this goes after the grid but before elements.
  renderSeamAllowance(
    context,
    visibleElements,
    elementsMap,
    appState,
    renderConfig.theme,
  );

  const groupsToBeAddedToFrame = new Set<string>();

  visibleElements.forEach((element) => {
    if (
      element.groupIds.length > 0 &&
      appState.frameToHighlight &&
      appState.selectedElementIds[element.id] &&
      (elementOverlapsWithFrame(
        element,
        appState.frameToHighlight,
        elementsMap,
      ) ||
        element.groupIds.find((groupId) => groupsToBeAddedToFrame.has(groupId)))
    ) {
      element.groupIds.forEach((groupId) =>
        groupsToBeAddedToFrame.add(groupId),
      );
    }
  });

  const inFrameGroupsMap = new Map<string, boolean>();

  // Paint visible elements
  visibleElements
    .filter((el) => !isIframeLikeElement(el))
    .forEach((element) => {
      try {
        const frameId = element.frameId || appState.frameToHighlight?.id;

        if (
          isTextElement(element) &&
          element.containerId &&
          elementsMap.has(element.containerId)
        ) {
          // will be rendered with the container
          return;
        }

        context.save();

        if (
          frameId &&
          appState.frameRendering.enabled &&
          appState.frameRendering.clip
        ) {
          const frame = getTargetFrame(element, elementsMap, appState);
          if (
            frame &&
            shouldApplyFrameClip(
              element,
              frame,
              appState,
              elementsMap,
              inFrameGroupsMap,
            )
          ) {
            frameClip(frame, context, renderConfig, appState);
          }
          renderElement(
            element,
            elementsMap,
            allElementsMap,
            rc,
            context,
            renderConfig,
            appState,
          );
        } else {
          renderElement(
            element,
            elementsMap,
            allElementsMap,
            rc,
            context,
            renderConfig,
            appState,
          );
        }

        const boundTextElement = getBoundTextElement(element, elementsMap);
        if (boundTextElement) {
          renderElement(
            boundTextElement,
            elementsMap,
            allElementsMap,
            rc,
            context,
            renderConfig,
            appState,
          );
        }

        context.restore();

        if (!isExporting) {
          renderLinkIcon(element, context, appState, elementsMap);
        }
      } catch (error: any) {
        console.error(
          error,
          element.id,
          element.x,
          element.y,
          element.width,
          element.height,
        );
      }
    });

  if (!isExporting) {
    renderMeasurementLabels(
      context,
      visibleElements,
      elementsMap,
      appState,
      renderConfig.theme,
    );
  }

  // render embeddables on top
  visibleElements
    .filter((el) => isIframeLikeElement(el))
    .forEach((element) => {
      try {
        const render = () => {
          renderElement(
            element,
            elementsMap,
            allElementsMap,
            rc,
            context,
            renderConfig,
            appState,
          );

          if (
            isIframeLikeElement(element) &&
            (isExporting ||
              (isEmbeddableElement(element) &&
                renderConfig.embedsValidationStatus.get(element.id) !==
                  true)) &&
            element.width &&
            element.height
          ) {
            const label = createPlaceholderEmbeddableLabel(element);
            renderElement(
              label,
              elementsMap,
              allElementsMap,
              rc,
              context,
              renderConfig,
              appState,
            );
          }
          if (!isExporting) {
            renderLinkIcon(element, context, appState, elementsMap);
          }
        };
        // - when exporting the whole canvas, we DO NOT apply clipping
        // - when we are exporting a particular frame, apply clipping
        //   if the containing frame is not selected, apply clipping
        const frameId = element.frameId || appState.frameToHighlight?.id;

        if (
          frameId &&
          appState.frameRendering.enabled &&
          appState.frameRendering.clip
        ) {
          context.save();

          const frame = getTargetFrame(element, elementsMap, appState);

          if (
            frame &&
            shouldApplyFrameClip(
              element,
              frame,
              appState,
              elementsMap,
              inFrameGroupsMap,
            )
          ) {
            frameClip(frame, context, renderConfig, appState);
          }
          render();
          context.restore();
        } else {
          render();
        }
      } catch (error: any) {
        console.error(error);
      }
    });

  // render pending nodes for flowcharts
  renderConfig.pendingFlowchartNodes?.forEach((element) => {
    try {
      renderElement(
        element,
        elementsMap,
        allElementsMap,
        rc,
        context,
        renderConfig,
        appState,
      );
    } catch (error) {
      console.error(error);
    }
  });
};

/** throttled to animation framerate */
export const renderStaticSceneThrottled = throttleRAF(
  (config: StaticSceneRenderConfig) => {
    _renderStaticScene(config);
  },
);

/**
 * Static scene is the non-ui canvas where we render elements.
 */
export const renderStaticScene = (
  renderConfig: StaticSceneRenderConfig,
  throttle?: boolean,
) => {
  if (throttle) {
    renderStaticSceneThrottled(renderConfig);
    return;
  }

  _renderStaticScene(renderConfig);
};
