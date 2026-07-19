import { getColorAlpha, KEYS, setColorAlpha } from "@excalidraw/common";

import { t } from "../../i18n";

export const ColorAlpha = ({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) => {
  const alpha = getColorAlpha(color);
  const opaqueColor = setColorAlpha(color, 100) || "#000000";

  return (
    <label className="color-picker__alpha">
      <span>{t("labels.opacity")}</span>
      <input
        className="color-picker__alpha-range"
        style={{ ["--alpha-color" as string]: opaqueColor }}
        type="range"
        min={0}
        max={100}
        step={1}
        value={alpha}
        aria-valuetext={`${alpha}%`}
        data-testid="color-alpha"
        onChange={(event) => {
          const nextColor = setColorAlpha(color, Number(event.target.value));
          if (nextColor) {
            onChange(nextColor);
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== KEYS.TAB) {
            event.stopPropagation();
          }
        }}
      />
      <output>{alpha}%</output>
    </label>
  );
};
