import type { ExpoConfig } from "expo/config";

// Web-only Expo Router app: `web.output: "server"` emits dist/client and dist/server for Node.
const config: ExpoConfig = {
  name: "Handoff API",
  slug: "handoff-api",
  scheme: "handoff-api",
  version: "0.0.0",
  platforms: ["web"],
  web: {
    bundler: "metro",
    output: "server",
  },
  plugins: [["expo-router", { root: "./src/app" }]],
};

export default config;
