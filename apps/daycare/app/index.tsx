import { useAuth } from "@clerk/clerk-expo";
import { ChildListScreen } from "@handoff/features";
import { Redirect, useRouter } from "expo-router";
import { useCallback } from "react";

import { flavor } from "../src/flavor";

export default function HomeRoute() {
  const { isSignedIn } = useAuth();
  const router = useRouter();

  const openChild = useCallback(
    (childId: string) => router.push({ pathname: "/children/[childId]", params: { childId } }),
    [router],
  );
  const openOnboarding = useCallback(() => router.push("/onboarding"), [router]);
  const openInvitations = useCallback(() => router.push("/invitations"), [router]);
  const startOnboarding = useCallback(() => router.replace("/onboarding"), [router]);

  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <ChildListScreen
      flavor={flavor}
      onSelectChild={openChild}
      onAddChild={openOnboarding}
      onInvite={openInvitations}
      onNeedsOnboarding={startOnboarding}
    />
  );
}
