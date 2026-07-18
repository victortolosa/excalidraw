# Pattern Tools — Future Features Backlog

Deferred sewing-pattern features, kept out of the current build to keep it simple. Each is optional and independent — pick one up when it's wanted. Phase 6 (grid, measurements, seam allowance) is shipped; see `archive/DASHBOARD_STEPS.md` for what landed.

Config lives in `appState` under the `patternGrid*` prefix (with matching `{ browser, export, server }` persistence in `packages/excalidraw/appState.ts` and a `types.ts` entry in both `AppState` and the `StaticCanvasAppState` pick, threaded through `StaticCanvas.tsx`). Seam-allowance geometry is in `packages/excalidraw/seamAllowance.ts` (unit-tested in `seamAllowance.test.ts`); rendering is in `packages/excalidraw/renderer/staticScene.ts`; the control UI is `packages/excalidraw/components/PatternGridWidget.tsx`.

## Seam allowance — follow-ups

- [ ] **Per-edge allowances (hem ≠ seam).** Today one allowance applies to the whole piece. Real patterns use a wider hem on some edges (e.g. 1" hem, 1/2" seams). Needs a per-edge allowance value and a way to pick/assign it per edge (probably only meaningful for line/polygon pieces where edges are addressable). `offsetClosedPolygon` would take a per-edge allowance array instead of a scalar; the miter/bevel math already works edge-by-edge, so the offset-line shift just reads `allowance[i]` per edge.

- [ ] **Notches.** Alignment marks across the seam line (single/double/T notches) that a sewist matches when joining pieces. Needs placement (position along an edge) + rendering of the mark straddling the finished + cut lines. Consider whether notches are their own element type or metadata on a piece.

- [ ] **Inner offset (facings / understitch lines).** The seam-allowance code only offsets outward (cut line). An inward offset would draw facing/stitch guides inside the finished line. `offsetClosedPolygon` currently flips the outward normal by winding; an inner offset is the same algorithm with the opposite sign, plus the self-intersection fallback matters more (inward offset collapses concave shapes quickly).

## Shipped

- **Inch-based stroke width (pattern mode).** When `patternGridModeEnabled`, the
  thin/medium/bold stroke picker is replaced by fraction presets (1/64", 1/32",
  1/16") plus a numeric inch input. Values convert to a scene-pixel `strokeWidth`
  via `patternGridPixelsPerInch`, so a line prints at the specified real-world
  thickness. Conversion + clamping live in `packages/excalidraw/patternGrid.ts`
  (`patternGridInchesToStrokeWidth` / `...ToInches`,
  `getNormalizedPatternGridStrokeWidthInches`; unit-tested in
  `patternGrid.test.ts`). The action is `actionChangeStrokeWidth` in
  `packages/excalidraw/actions/actionProperties.tsx` (value is now
  `StrokeWidthKey | { customInches: number }`). New-element default is tracked by
  `appState.currentItemPatternStrokeWidth` (raw px; `null` falls back to the
  preset key), applied in `App.tsx`'s `getCurrentItemStrokeWidth`.

## Other ideas (unscoped)

_Add future sewing-pattern tool ideas here as they come up._
