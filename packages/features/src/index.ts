// Screen compositions shared by both app flavors. They receive navigation as callbacks and never
// import a router, so each app maps them to its own routes.

export { SignInScreen } from "./auth/SignInScreen";
export { useSignOutWithOutboxNotice } from "./auth/useSignOutWithOutboxNotice";
export { OnboardingScreen } from "./onboarding/OnboardingScreen";
export { ChildListScreen } from "./children/ChildListScreen";
export { ChildProfileScreen } from "./children/ChildProfileScreen";
export { InvitationsScreen } from "./invitations/InvitationsScreen";
export { CareDashboardScreen } from "./journal/CareDashboardScreen";
export { JournalScreen } from "./journal/JournalScreen";
export { AttachmentViewer } from "./journal/AttachmentViewer";
export { dedupeAttachmentsByCapture } from "./journal/lib/dedupe-attachments-by-capture";
export { EventEditor } from "./journal/EventEditor";
export { QuickEntrySheet } from "./journal/QuickEntrySheet";
export { RecordScreen } from "./recording/RecordScreen";
export { ReviewCaptureScreen } from "./recording/ReviewCaptureScreen";
export { AttachmentPicker } from "./recording/AttachmentPicker";
export { useAddAttachment } from "./recording/useAddAttachment";
export { attachmentTileStatus, describeStageFailure } from "./recording/lib/attachment-state";
export {
  describeAttachmentLimit,
  remainingAttachmentSlots,
} from "./recording/lib/attachment-limits";
export { HandoffScreen } from "./handoff/HandoffScreen";
export { PrivacySettingsScreen } from "./settings/PrivacySettingsScreen";
export { ProcessingNoticeCard } from "./settings/ProcessingNoticeCard";
export {
  PROCESSING_NOTICE_VERSION,
  hasAcceptedProcessingNotice,
} from "./settings/lib/processing-notice";
export { CareStatus } from "./care/CareStatus";

export type { SignInMode, SignInScreenProps, SignInStep } from "./auth/types/sign-in-screen";
export type { SignOutWithOutboxNotice } from "./auth/types/sign-out-notice";
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
export type {
  AttachmentModalProps,
  AttachmentThumbnailProps,
  AttachmentViewerProps,
} from "./journal/types/attachment-viewer";
export type { EventEditorProps } from "./journal/types/event-editor";
export type { QuickEntrySheetProps } from "./journal/types/quick-entry-sheet";
export type { EntryForm, OccurrenceTime } from "./journal/types/entry-form";
export type {
  RecordScreenProps,
  ReviewCaptureScreenProps,
  ReviewTarget,
  TypeInsteadSheetProps,
} from "./recording/types/recording";
export type {
  AddAttachmentFailure,
  AttachmentPickerProps,
  UseAddAttachment,
} from "./recording/types/attachment-picker";
export type { AddAttachmentContext } from "./recording/useAddAttachment";
export type { BriefEntryRowProps, HandoffScreenProps } from "./handoff/types/handoff-screen";
export type { CareStatusProps } from "./care/types/care-status";
export type {
  DangerConfirmationProps,
  PrivacySettingsScreenProps,
} from "./settings/types/privacy-settings-screen";
export type { ProcessingNoticeCardProps } from "./settings/types/processing-notice";
