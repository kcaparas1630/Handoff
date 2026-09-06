import type { AppFlavor } from "@handoff/ui";
import type { ReactNode } from "react";

export type MobileProvidersProps = {
  children: ReactNode;
  /** Names the app while Clerk loads, so the first frame is not an unexplained blank screen. */
  flavor: AppFlavor;
  /** Clerk publishable key from EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY; the secret key never ships. */
  publishableKey: string;
  /** API origin from EXPO_PUBLIC_API_URL. */
  apiUrl: string;
};
