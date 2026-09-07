import type { ReactNode } from "react";

export type PrivacySettingsScreenProps = {
  /** Preselected by the route from the context store; null when no child is selected. */
  childId: string | null;
  workspaceId: string | null;
  /** Called once the child's deletion has been accepted, so the app can leave its screens. */
  onChildDeleted: () => void;
  onWorkspaceDeleted: () => void;
  /** Called after the local files are gone and Clerk's sign-out has resolved. */
  onSignedOut: () => void;
  onBack: () => void;
};

export type SettingsSectionProps = {
  title: string;
  /** One sentence saying what this section changes, in plain language. */
  description: string;
  children: ReactNode;
  testID?: string;
};

export type DangerConfirmationProps = {
  /** Label of the button that opens the confirmation, e.g. "Delete this child". */
  armLabel: string;
  heading: string;
  consequences: readonly string[];
  /**
   * An extra "I understand" step before typing. Used for workspace deletion, which removes
   * everyone's access rather than one record.
   */
  requiresAcknowledgement?: boolean;
  acknowledgementLabel?: string;
  /** The exact text the caregiver has to type, normally the child's or workspace's name. */
  confirmPhrase: string;
  confirmPhraseLabel: string;
  confirmLabel: string;
  isBusy: boolean;
  errorMessage: string | null;
  onConfirm: () => void;
  testIDPrefix: string;
};

export type DeleteChildSectionProps = {
  childId: string;
  childName: string;
  onDeleted: () => void;
};

export type DeleteWorkspaceSectionProps = {
  workspaceId: string;
  workspaceName: string;
  onDeleted: () => void;
};

export type SignOutSectionProps = {
  onSignedOut: () => void;
};
