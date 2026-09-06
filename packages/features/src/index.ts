// Screen compositions shared by both app flavors. They receive navigation as callbacks and never
// import a router, so each app maps them to its own routes.

export { SignInScreen } from "./auth/SignInScreen";
export { OnboardingScreen } from "./onboarding/OnboardingScreen";
export { ChildListScreen } from "./children/ChildListScreen";
export { ChildProfileScreen } from "./children/ChildProfileScreen";
export { InvitationsScreen } from "./invitations/InvitationsScreen";
export { CareDashboardScreen } from "./journal/CareDashboardScreen";
export { JournalScreen } from "./journal/JournalScreen";
export { EventEditor } from "./journal/EventEditor";
export { QuickEntrySheet } from "./journal/QuickEntrySheet";
export { HandoffScreen } from "./handoff/HandoffScreen";
export { CareStatus } from "./care/CareStatus";

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
export type { CareDashboardScreenProps } from "./journal/types/care-dashboard-screen";
export type { JournalFilter, JournalScreenProps } from "./journal/types/journal-screen";
export type { EventEditorProps } from "./journal/types/event-editor";
export type { QuickEntrySheetProps } from "./journal/types/quick-entry-sheet";
export type { EntryForm, OccurrenceTime } from "./journal/types/entry-form";
export type { HandoffScreenProps } from "./handoff/types/handoff-screen";
export type { CareStatusProps } from "./care/types/care-status";
