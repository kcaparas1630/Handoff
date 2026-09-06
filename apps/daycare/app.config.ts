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
  plugins: [
    "expo-router",
    [
      "expo-audio",
      {
        // Recording only happens after an explicit tap, and background recording stays off.
        microphonePermission: "Handoff records short care updates only when you tap Record.",
        recordAudioAndroid: true,
        enableBackgroundRecording: false,
        enableBackgroundPlayback: false,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission: "Handoff attaches photos you choose to a care update.",
        cameraPermission: "Handoff uses the camera only when you tap Take photo.",
      },
    ],
  ],
};

export default config;
