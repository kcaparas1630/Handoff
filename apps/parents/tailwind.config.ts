import nativewindPreset from "@handoff/config/nativewind-preset";
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
    "../../packages/features/src/**/*.{ts,tsx}",
  ],
  presets: [nativewindPreset],
  theme: { extend: {} },
  plugins: [],
};

export default config;
