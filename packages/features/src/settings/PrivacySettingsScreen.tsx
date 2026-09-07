import { useBootstrap, useChild } from "@handoff/api-client";
import { Button, Screen, StatusMessage } from "@handoff/ui";
import { Text } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import { DeleteChildSection } from "./DeleteChildSection";
import { DeleteWorkspaceSection } from "./DeleteWorkspaceSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { LocalFilesSection } from "./LocalFilesSection";
import { ProcessingNoticeCard } from "./ProcessingNoticeCard";
import { SettingsSection } from "./SettingsSection";
import { SignOutSection } from "./SignOutSection";
import type { PrivacySettingsScreenProps } from "./types/privacy-settings-screen";

/**
 * Privacy and data for the signed-in account: what leaves the phone, what can be deleted, what is
 * still on this device, and how to sign out. Visibility here is not authorization; the API rechecks
 * ownership on every delete.
 */
export function PrivacySettingsScreen({
  childId,
  workspaceId,
  onChildDeleted,
  onWorkspaceDeleted,
  onSignedOut,
  onBack,
}: PrivacySettingsScreenProps) {
  const bootstrap = useBootstrap();
  const child = useChild(childId);

  if (bootstrap.isPending) {
    return (
      <Screen>
        <StatusMessage tone="info" message="Loading your account…" />
        <Button label="Back" variant="quiet" onPress={onBack} />
      </Screen>
    );
  }

  if (bootstrap.isError) {
    return (
      <Screen>
        <StatusMessage tone="error" message={describeError(bootstrap.error)} />
        <Button label="Try again" onPress={() => void bootstrap.refetch()} />
        <Button label="Back" variant="quiet" onPress={onBack} />
      </Screen>
    );
  }

  const workspace =
    bootstrap.data.workspaces.find((candidate) => candidate.id === workspaceId) ??
    bootstrap.data.workspaces.find((candidate) => candidate.id === child.data?.workspaceId) ??
    null;
  const isOwner = workspace?.appRole === "owner";
  // A child from another workspace must not borrow this workspace's owner role.
  const isChildInWorkspace =
    child.data !== undefined && workspace !== null && child.data.workspaceId === workspace.id;

  return (
    <Screen scroll testID="privacy-settings">
      <Text className="text-2xl font-semibold text-primary dark:text-primary-dark">
        Privacy and data
      </Text>

      <ProcessingNoticeCard acceptedVersion={bootstrap.data.user.processingNoticeVersion} />

      <SettingsSection
        title="Your data"
        description={
          isOwner
            ? "Deleting removes records for everyone who can see them, not only from this phone."
            : "Only a workspace owner can delete a child or a workspace. Ask them if something needs to go."
        }
        testID="your-data-section"
      >
        {workspace === null ? (
          <StatusMessage
            tone="info"
            message="Open a child first; the deletion controls apply to the workspace you were last in."
          />
        ) : null}

        {isOwner && isChildInWorkspace && child.data !== undefined ? (
          <DeleteChildSection
            childId={child.data.id}
            childName={child.data.name}
            onDeleted={onChildDeleted}
          />
        ) : null}

        {isOwner && workspace !== null ? (
          <DeleteWorkspaceSection
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            onDeleted={onWorkspaceDeleted}
          />
        ) : null}

        {isOwner ? (
          <StatusMessage
            tone="info"
            message="Deleting your Handoff account itself happens where you sign in, not here; that removes your access and anonymizes your entries."
          />
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Recordings on this phone"
        description="Files Handoff has not accepted yet live only here, and nobody else can see them."
      >
        <LocalFilesSection />
      </SettingsSection>

      <SettingsSection
        title="Diagnostics"
        description="For a pilot observer. Counts stay on this phone and are never sent anywhere."
      >
        <DiagnosticsSection />
      </SettingsSection>

      <SettingsSection
        title="Sign out"
        description="Signing out deletes this account's recordings and files from this phone."
      >
        <SignOutSection onSignedOut={onSignedOut} />
      </SettingsSection>

      <Button label="Back" variant="quiet" onPress={onBack} />
    </Screen>
  );
}
