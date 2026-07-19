import { ROUNDNESS } from "@excalidraw/common";
import { pointFrom, type LocalPoint } from "@excalidraw/math";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import { ShapeCache } from "../src/shape";

const createLine = (
  overrides: Partial<{
    strokeStyle: "solid" | "dashed" | "dotted";
    roundness: { type: typeof ROUNDNESS.PROPORTIONAL_RADIUS } | null;
  }> = {},
) =>
  API.createElement({
    type: "line",
    points: [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(100, 0),
      pointFrom<LocalPoint>(100, 100),
    ],
    strokeWidth: 20,
    strokeStyle: overrides.strokeStyle ?? "solid",
    roundness: overrides.roundness ?? null,
  });

describe("pattern stroke alignment", () => {
  it("renders a sharp solid line as an exact filled band", () => {
    const line = createLine();
    const shapes = ShapeCache.generatePatternOffsetShape(
      line,
      "outside",
      false,
    );

    expect(shapes).not.toBeNull();
    expect(shapes![0].options.stroke).toBe("none");
    expect(shapes![0].options.fill).toBe(line.strokeColor);
    expect(shapes![0].options.roughness).toBe(0);
  });

  it.each(["dashed", "dotted"] as const)(
    "preserves the %s stroke pattern on an offset centerline",
    (strokeStyle) => {
      const shapes = ShapeCache.generatePatternOffsetShape(
        createLine({ strokeStyle }),
        "outside",
        false,
      );

      expect(shapes).not.toBeNull();
      expect(shapes![0].options.stroke).not.toBe("none");
      expect(shapes![0].options.strokeLineDash).toBeDefined();
      expect(shapes![0].options.fill).toBeUndefined();
    },
  );

  it("preserves rounded lines using an offset curve", () => {
    const shapes = ShapeCache.generatePatternOffsetShape(
      createLine({
        roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
      }),
      "inside",
      false,
    );

    expect(shapes).not.toBeNull();
    expect(shapes![0].shape).toBe("curve");
    expect(shapes![0].options.stroke).not.toBe("none");
  });
});
