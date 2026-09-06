import "../global.css";

import { MobileProviders } from "@handoff/mobile";
import { Screen, StatusMessage } from "@handoff/ui";
import { Stack } from "expo-router";

import { flavor, flavorDisplayName } from "../src/flavor";

// Read at module scope so Expo inlines the EXPO_PUBLIC_* values into the bundle.
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const apiUrl = process.env.EXPO_PUBLIC_API_URL;

export default function RootLayout() {
  if (!publishableKey) return <MissingEnvironment name="EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY" />;
  if (!apiUrl) return <MissingEnvironment name="EXPO_PUBLIC_API_URL" />;

  return (
    <MobileProviders flavor={flavor} publishableKey={publishableKey} apiUrl={apiUrl}>
      <Stack screenOptions={{ title: flavorDisplayName }} />
    </MobileProviders>
  );
}

// Names the missing variable only. Its value must never reach the screen or a log.
function MissingEnvironment({ name }: { name: string }) {
  return (
    <Screen>
      <StatusMessage
        tone="error"
        message={`${flavorDisplayName} cannot start: ${name} is not set for this build.`}
      />
    </Screen>
  );
}
