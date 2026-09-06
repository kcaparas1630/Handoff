import { useChild } from "@handoff/api-client";
import { RecordScreen } from "@handoff/features";
import type { ReviewTarget } from "@handoff/features";
import { Screen, StatusMessage } from "@handoff/ui";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

export default function RecordRoute() {
  const router = useRouter();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const child = useChild(childId ?? null);

  // A recording the server has not acknowledged yet is addressed by its local id.
  const openReview = useCallback(
    (target: ReviewTarget) =>
      router.replace({
        pathname: "/captures/[captureId]",
        params: {
          captureId: target.kind === "capture" ? target.captureId : `local:${target.localId}`,
        },
      }),
    [router],
  );
  const goBack = useCallback(() => router.back(), [router]);

  if (!childId) {
    return (
      <Screen>
        <StatusMessage tone="error" message="Open this from a child's page to record an update." />
      </Screen>
    );
  }

  return (
    <>
      {/* Identity context stays in the navigation bar while recording. */}
      <Stack.Screen options={{ title: child.data?.name ?? "Record update" }} />
      <RecordScreen childId={childId} onReview={openReview} onCancel={goBack} />
    </>
  );
}
