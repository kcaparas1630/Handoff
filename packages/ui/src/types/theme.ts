export type ThemeMode = "light" | "dark";

export type AppFlavor = "parents" | "daycare";

export type ThemeColors = {
  /** Page background. */
  background: string;
  /** Raised card / sheet background. */
  surface: string;
  /** Brand green used for body text, headings, and primary fills. */
  primary: string;
  /** Restrained warm accent for emphasis, never the only signal. */
  accent: string;
  /** Secondary text that must stay readable on background and surface. */
  mutedText: string;
  /** Hairline separators and control outlines. */
  border: string;
};

export type SpacingScale = {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
};

export type RadiusScale = {
  sm: number;
  md: number;
  lg: number;
  pill: number;
};

export type Theme = {
  mode: ThemeMode;
  colors: ThemeColors;
  spacing: SpacingScale;
  radius: RadiusScale;
  /** Logical-unit floor for interactive targets (docs/experience-design.md section 5). */
  minTouchTarget: number;
};
