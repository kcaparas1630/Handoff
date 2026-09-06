import type { AppFlavor } from "@handoff/ui";

export type SignInScreenProps = {
  flavor: AppFlavor;
  /** Called once Clerk has an active session; the app decides where to go next. */
  onSignedIn: () => void;
};

export type SignInMode = "sign-in" | "sign-up";

export type SignInStep = "email" | "code";
