import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Handoff Daycare",
  slug: "handoff-daycare",
  scheme: "handoff-daycare",
  version: "0.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.handoff.daycare",
    supportsTablet: false,
  },
  android: {
    package: "com.handoff.daycare",
  },
  web: {
    bundler: "metro",
  },
  plugins: ["expo-router"],
};

export default config;
