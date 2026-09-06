import { useChild } from "@handoff/api-client";
import { JournalScreen } from "@handoff/features";
import { Screen, StatusMessage } from "@handoff/ui";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

export default function ChildJournalRoute() {
  const router = useRouter();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const child = useChild(childId ?? null);
  const goBack = useCallback(() => router.back(), [router]);
  const openEvent = useCallback(
    (eventId: string) =>
      router.push({ pathname: "/events/[eventId]", params: { eventId, childId: childId ?? "" } }),
    [router, childId],
  );

  if (!childId) {
    return (
      <Screen>
        <StatusMessage
          tone="error"
          message="This link is missing a child, so nothing was opened."
        />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: child.data?.name ?? "Journal" }} />
      <JournalScreen childId={childId} onOpenEvent={openEvent} onBack={goBack} />
    </>
  );
}
