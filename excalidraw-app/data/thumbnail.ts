import {
  exportToCanvas,
  exportToSvg,
} from "@excalidraw/excalidraw/scene/export";

import type {
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

const MAX_BYTES = 1_000_000;

/** Keep the SVG storage contract, but embed only a bounded preview bitmap. */
export const createThumbnail = async ({
  elements,
  appState,
  files,
}: {
  elements: readonly OrderedExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
}) => {
  const visible = elements.filter(
    (
      element,
    ): element is OrderedExcalidrawElement & NonDeletedExcalidrawElement =>
      !element.isDeleted,
  );
  const options = {
    exportBackground: true,
    viewBackgroundColor: appState.viewBackgroundColor ?? "#ffffff",
    exportPadding: 16,
  };
  if (!visible.length) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "640");
    svg.setAttribute("height", "360");
    const background = document.createElementNS(svg.namespaceURI, "rect");
    background.setAttribute("width", "100%");
    background.setAttribute("height", "100%");
    background.setAttribute("fill", options.viewBackgroundColor);
    svg.appendChild(background);
    return svg.outerHTML;
  }
  try {
    for (const maxDimension of [640, 320, 160]) {
      const canvas = await exportToCanvas(
        visible,
        { ...appState, exportWithDarkMode: false },
        files,
        options,
        (width, height) => {
          if (!Number.isFinite(width) || !Number.isFinite(height)) {
            throw new Error("Invalid thumbnail bounds");
          }
          const scale = Math.min(1, maxDimension / Math.max(width, height, 1));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.ceil(width * scale));
          canvas.height = Math.max(1, Math.ceil(height * scale));
          return { canvas, scale };
        },
      );
      const data = canvas.toDataURL("image/png");
      if (!data.startsWith("data:image/png;base64,")) {
        throw new Error("Thumbnail canvas could not be encoded");
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><image width="100%" height="100%" href="${data}"/></svg>`;
      if (new Blob([svg]).size <= MAX_BYTES) {
        return svg;
      }
    }
    throw new Error("Thumbnail bitmap exceeds upload limit");
  } catch (error) {
    // Preserve shapes and text if an image cannot be painted onto a canvas.
    const svg = await exportToSvg(
      visible,
      { ...options, exportScale: 0.5 },
      files,
      { skipInliningFonts: true },
    );
    const result = svg.outerHTML;
    if (new Blob([result]).size > MAX_BYTES) {
      throw new Error("Thumbnail exceeds upload limit", { cause: error });
    }
    return result;
  }
};
