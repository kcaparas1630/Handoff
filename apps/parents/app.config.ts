import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Handoff Parents",
  slug: "handoff-parents",
  scheme: "handoff-parents",
  version: "0.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.handoff.parents",
    supportsTablet: false,
  },
  android: {
    package: "com.handoff.parents",
  },
  web: {
    bundler: "metro",
  },
  plugins: ["expo-router"],
};

export default config;
