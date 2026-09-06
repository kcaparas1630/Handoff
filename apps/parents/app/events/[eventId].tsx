import { EventEditor } from "@handoff/features";
import { Screen, StatusMessage } from "@handoff/ui";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

export default function EventEditorRoute() {
  const router = useRouter();
  const { eventId, childId } = useLocalSearchParams<{ eventId: string; childId: string }>();
  const goBack = useCallback(() => router.back(), [router]);

  // The entry is read back from its child's journal pages, so both ids must be present.
  if (!eventId || !childId) {
    return (
      <Screen>
        <StatusMessage
          tone="error"
          message="Open this entry from the child's journal so it can be loaded."
        />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Correct entry" }} />
      <EventEditor eventId={eventId} childId={childId} onDone={goBack} />
    </>
  );
}
