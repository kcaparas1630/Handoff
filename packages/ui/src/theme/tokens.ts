import type { RadiusScale, SpacingScale, Theme, ThemeColors, ThemeMode } from "../types/theme";

// Starting design values from docs/experience-design.md section 5. Contrast of every text,
// disabled, and dark combination is untested and must be measured before shipping.
export const lightColors: ThemeColors = {
  background: "#F5F1E8",
  surface: "#FFFCF6",
  primary: "#183F35",
  accent: "#CC704F",
  mutedText: "#4A5B53",
  border: "#E2DACB",
};

// Calm night appearance. Starting values only; contrast is untested.
export const darkColors: ThemeColors = {
  background: "#101A16",
  surface: "#182823",
  primary: "#E8F0EA",
  accent: "#E29273",
  mutedText: "#A7BCB2",
  border: "#2A3B34",
};

export const spacing: SpacingScale = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius: RadiusScale = { sm: 8, md: 12, lg: 20, pill: 999 };

export const minTouchTarget = 48;

export const lightTheme: Theme = {
  mode: "light",
  colors: lightColors,
  spacing,
  radius,
  minTouchTarget,
};

export const darkTheme: Theme = {
  mode: "dark",
  colors: darkColors,
  spacing,
  radius,
  minTouchTarget,
};

export const themes: Record<ThemeMode, Theme> = { light: lightTheme, dark: darkTheme };
