import { InvitationsScreen } from "@handoff/features";
import { useSelectedContext } from "@handoff/mobile";
import { Button, Screen, StatusMessage } from "@handoff/ui";
import { useRouter } from "expo-router";
import { useCallback } from "react";

import { flavor } from "../src/flavor";

export default function InvitationsRoute() {
  const router = useRouter();
  const workspaceId = useSelectedContext((state) => state.selectedWorkspaceId);
  const goBack = useCallback(() => router.back(), [router]);

  if (workspaceId === null) {
    return (
      <Screen>
        <StatusMessage
          tone="info"
          message="Open your child list first so Handoff knows which workspace to invite into."
        />
        <Button label="Back" variant="quiet" onPress={goBack} />
      </Screen>
    );
  }

  return <InvitationsScreen flavor={flavor} workspaceId={workspaceId} onBack={goBack} />;
}
