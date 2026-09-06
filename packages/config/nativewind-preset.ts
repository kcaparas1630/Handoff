import nativewindPreset from "nativewind/preset";
import type { Config } from "tailwindcss";

import { darkColors, lightColors, minTouchTarget, radius, spacing } from "../ui/src/theme/tokens";

// Single Tailwind preset shared by every app so class names resolve to the tokens in
// @handoff/ui. The `dark` keys back the `dark:` variants; their contrast is untested.
const px = (value: number) => `${value}px`;

const handoffPreset: Partial<Config> = {
  presets: [nativewindPreset],
  theme: {
    extend: {
      colors: {
        background: { DEFAULT: lightColors.background, dark: darkColors.background },
        surface: { DEFAULT: lightColors.surface, dark: darkColors.surface },
        primary: { DEFAULT: lightColors.primary, dark: darkColors.primary },
        accent: { DEFAULT: lightColors.accent, dark: darkColors.accent },
        muted: { DEFAULT: lightColors.mutedText, dark: darkColors.mutedText },
        border: { DEFAULT: lightColors.border, dark: darkColors.border },
      },
      spacing: {
        xs: px(spacing.xs),
        sm: px(spacing.sm),
        md: px(spacing.md),
        lg: px(spacing.lg),
        xl: px(spacing.xl),
        xxl: px(spacing.xxl),
        touch: px(minTouchTarget),
      },
      borderRadius: {
        sm: px(radius.sm),
        md: px(radius.md),
        lg: px(radius.lg),
        pill: px(radius.pill),
      },
    },
  },
};

export default handoffPreset;
