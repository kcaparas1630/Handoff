import { PrivacySettingsScreen } from "@handoff/features";
import { useSelectedContext } from "@handoff/mobile";
import { Stack, useRouter } from "expo-router";
import { useCallback } from "react";

export default function SettingsRoute() {
  const router = useRouter();
  const selectedChildId = useSelectedContext((state) => state.selectedChildId);
  const selectedWorkspaceId = useSelectedContext((state) => state.selectedWorkspaceId);
  const resetSelection = useSelectedContext((state) => state.resetSelection);

  const goBack = useCallback(() => router.back(), [router]);

  // A deleted record's screens must not stay on the stack, so the app returns to the child list.
  const returnHome = useCallback(() => {
    resetSelection();
    router.dismissAll();
    router.replace("/");
  }, [resetSelection, router]);

  const afterSignOut = useCallback(() => {
    resetSelection();
    router.dismissAll();
    router.replace("/sign-in");
  }, [resetSelection, router]);

  return (
    <>
      <Stack.Screen options={{ title: "Privacy and data" }} />
      <PrivacySettingsScreen
        childId={selectedChildId}
        workspaceId={selectedWorkspaceId}
        onChildDeleted={returnHome}
        onWorkspaceDeleted={returnHome}
        onSignedOut={afterSignOut}
        onBack={goBack}
      />
    </>
  );
}
