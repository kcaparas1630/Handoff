import { OnboardingScreen } from "@handoff/features";
import { useRouter } from "expo-router";
import { useCallback } from "react";

import { flavor } from "../src/flavor";

export default function OnboardingRoute() {
  const router = useRouter();
  const openNewChild = useCallback(
    (_workspaceId: string, childId: string) =>
      router.replace({ pathname: "/children/[childId]", params: { childId } }),
    [router],
  );

  return <OnboardingScreen flavor={flavor} onCompleted={openNewChild} />;
}
