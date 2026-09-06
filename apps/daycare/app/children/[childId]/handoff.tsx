import { useChild } from "@handoff/api-client";
import { HandoffScreen } from "@handoff/features";
import { Screen, StatusMessage } from "@handoff/ui";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

export default function ChildHandoffRoute() {
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
      <Stack.Screen options={{ title: child.data?.name ?? "Handoff" }} />
      <HandoffScreen childId={childId} onDone={goBack} onOpenEvent={openEvent} />
    </>
  );
}
