import { useChild } from "@handoff/api-client";
import { CareDashboardScreen } from "@handoff/features";
import { useSelectedContext } from "@handoff/mobile";
import { Screen, StatusMessage } from "@handoff/ui";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

import { flavor } from "../../../src/flavor";

export default function ChildDashboardRoute() {
  const router = useRouter();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const child = useChild(childId ?? null);
  const selectChild = useSelectedContext((state) => state.selectChild);

  const openHandoff = useCallback(
    (id: string) =>
      router.push({ pathname: "/children/[childId]/handoff", params: { childId: id } }),
    [router],
  );
  const openJournal = useCallback(
    (id: string) =>
      router.push({ pathname: "/children/[childId]/journal", params: { childId: id } }),
    [router],
  );
  const openProfile = useCallback(
    (id: string) =>
      router.push({ pathname: "/children/[childId]/profile", params: { childId: id } }),
    [router],
  );
  // Selecting the child first means the settings screen opens on the right record.
  const openSettings = useCallback(
    (id: string) => {
      selectChild(id);
      router.push("/settings");
    },
    [router, selectChild],
  );
  const openEvent = useCallback(
    (eventId: string) =>
      router.push({ pathname: "/events/[eventId]", params: { eventId, childId: childId ?? "" } }),
    [router, childId],
  );
  const openRecord = useCallback(
    (id: string) =>
      router.push({ pathname: "/children/[childId]/record", params: { childId: id } }),
    [router],
  );
  // Accepts a server capture id or `local:<id>` for a recording still on this phone.
  const openCapture = useCallback(
    (captureRef: string) =>
      router.push({ pathname: "/captures/[captureId]", params: { captureId: captureRef } }),
    [router],
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
      {/* Identity context stays in the navigation bar while reviewing and recording. */}
      <Stack.Screen options={{ title: child.data?.name ?? "Child" }} />
      <CareDashboardScreen
        childId={childId}
        flavor={flavor}
        onOpenHandoff={openHandoff}
        onOpenJournal={openJournal}
        onOpenEvent={openEvent}
        onOpenProfile={openProfile}
        onOpenSettings={openSettings}
        onOpenRecord={openRecord}
        onOpenCapture={openCapture}
      />
    </>
  );
}
