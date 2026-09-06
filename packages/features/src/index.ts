// Screen compositions shared by both app flavors. They receive navigation as callbacks and never
// import a router, so each app maps them to its own routes.

export { SignInScreen } from "./auth/SignInScreen";
export { OnboardingScreen } from "./onboarding/OnboardingScreen";
export { ChildListScreen } from "./children/ChildListScreen";
export { ChildProfileScreen } from "./children/ChildProfileScreen";
export { InvitationsScreen } from "./invitations/InvitationsScreen";

export type { SignInMode, SignInScreenProps, SignInStep } from "./auth/types/sign-in-screen";
export type {
  FirstChildStepProps,
  OnboardingScreenProps,
} from "./onboarding/types/onboarding-screen";
export type { ChildListScreenProps } from "./children/types/child-list-screen";
export type { ChildProfileScreenProps } from "./children/types/child-profile-screen";
export type {
  InvitationsScreenProps,
  InviteFormProps,
} from "./invitations/types/invitations-screen";
