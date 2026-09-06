import { ReviewCaptureScreen } from "@handoff/features";
import type { ReviewTarget } from "@handoff/features";
import { Screen, StatusMessage } from "@handoff/ui";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

const localPrefix = "local:";

export default function ReviewCaptureRoute() {
  const router = useRouter();
  const { captureId } = useLocalSearchParams<{ captureId: string }>();

  const openChild = useCallback(
    (childId: string) => router.replace({ pathname: "/children/[childId]", params: { childId } }),
    [router],
  );
  const goBack = useCallback(() => router.back(), [router]);

  if (!captureId) {
    return (
      <Screen>
        <StatusMessage tone="error" message="This link is missing the update it should open." />
      </Screen>
    );
  }

  // Either a server capture id or `local:<id>` for a recording still on this phone.
  const target: ReviewTarget = captureId.startsWith(localPrefix)
    ? { kind: "local", localId: captureId.slice(localPrefix.length) }
    : { kind: "capture", captureId };

  return (
    <>
      <Stack.Screen options={{ title: "Review update" }} />
      <ReviewCaptureScreen
        target={target}
        onSaved={(events) => {
          const childId = events[0]?.childId;
          if (childId === undefined) goBack();
          else openChild(childId);
        }}
        onEnterManually={openChild}
        onClose={goBack}
      />
    </>
  );
}
