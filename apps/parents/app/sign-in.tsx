import { SignInScreen } from "@handoff/features";
import { useRouter } from "expo-router";
import { useCallback } from "react";

import { flavor } from "../src/flavor";

export default function SignInRoute() {
  const router = useRouter();
  const goHome = useCallback(() => router.replace("/"), [router]);

  return <SignInScreen flavor={flavor} onSignedIn={goHome} />;
}
