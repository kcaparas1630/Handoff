import { useChild } from "@handoff/api-client";
import { ChildProfileScreen } from "@handoff/features";
import { Screen, StatusMessage } from "@handoff/ui";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

export default function ChildProfileRoute() {
  const router = useRouter();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const child = useChild(childId ?? null);
  const goBack = useCallback(() => router.back(), [router]);

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
      <Stack.Screen options={{ title: child.data?.name ?? "Child" }} />
      <ChildProfileScreen childId={childId} onBack={goBack} />
    </>
  );
}
