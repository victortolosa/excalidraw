import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  exportToCanvas,
  exportToSvg,
} from "@excalidraw/excalidraw/scene/export";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { vi } from "vitest";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

import { createThumbnail } from "../data/thumbnail";

vi.mock("@excalidraw/excalidraw/scene/export", () => ({
  exportToCanvas: vi.fn(),
  exportToSvg: vi.fn(),
}));

const job = () => ({
  elements: [
    API.createElement({ type: "rectangle" }) as OrderedExcalidrawElement,
  ],
  appState: {
    ...getDefaultAppState(),
    width: 1000,
    height: 1000,
    offsetTop: 0,
    offsetLeft: 0,
  },
  files: {},
});

beforeEach(() => vi.resetAllMocks());

it("bounds huge scenes before allocating a canvas", async () => {
  vi.mocked(exportToCanvas).mockImplementation(async (...args) => {
    const { canvas, scale } = args[4]!(100_000, 50_000);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(320);
    expect(scale).toBe(0.0064);
    canvas.toDataURL = () => "data:image/png;base64,preview";
    return canvas;
  });
  expect(await createThumbnail(job())).toContain('width="640"');
});

it("retries oversized previews at a smaller resolution", async () => {
  vi.mocked(exportToCanvas).mockImplementation(async (...args) => {
    const { canvas } = args[4]!(1000, 1000);
    canvas.toDataURL = () =>
      `data:image/png;base64,${"a".repeat(
        canvas.width === 640 ? 1_000_000 : 10,
      )}`;
    return canvas;
  });
  expect(await createThumbnail(job())).toContain('width="320"');
  expect(exportToCanvas).toHaveBeenCalledTimes(2);
});

it("falls back to vector export when canvas encoding fails", async () => {
  vi.mocked(exportToCanvas).mockRejectedValue(new Error("tainted canvas"));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  vi.mocked(exportToSvg).mockResolvedValue(svg);
  expect(await createThumbnail(job())).toBe(svg.outerHTML);
});

it("rejects oversized vector fallbacks before uploading", async () => {
  vi.mocked(exportToCanvas).mockRejectedValue(new Error("encoding failed"));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.textContent = "a".repeat(1_000_000);
  vi.mocked(exportToSvg).mockResolvedValue(svg);
  await expect(createThumbnail(job())).rejects.toThrow("upload limit");
});

it("replaces a cleared scene with a blank preview", async () => {
  const result = await createThumbnail({ ...job(), elements: [] });
  expect(result).toContain('<rect width="100%" height="100%"');
  expect(exportToCanvas).not.toHaveBeenCalled();
});
