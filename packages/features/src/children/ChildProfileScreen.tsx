import { useBootstrap, useChild, useChildCaregivers } from "@handoff/api-client";
import { Button, Screen, StatusMessage } from "@handoff/ui";
import { Text, View } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import { describeChildPermission } from "./lib/permission-label";
import type { ChildProfileScreenProps } from "./types/child-profile-screen";

const relationshipLabels = {
  parent: "Parent",
  relative: "Relative",
  caregiver: "Caregiver",
  other: "Other",
} as const;

export function ChildProfileScreen({ childId, onOpenSettings, onBack }: ChildProfileScreenProps) {
  const child = useChild(childId);
  const bootstrap = useBootstrap();
  // Only a manager may read the roster; the server answers 403 for readers and contributors.
  const canManageCaregivers = child.data?.permission === "manager";
  const caregivers = useChildCaregivers(canManageCaregivers ? childId : null);

  if (child.isPending) {
    return (
      <Screen>
        <StatusMessage tone="info" message="Loading this child's profile…" />
        <Button label="Back" variant="quiet" onPress={onBack} />
      </Screen>
    );
  }

  if (child.isError) {
    return (
      <Screen>
        <StatusMessage tone="error" message={describeError(child.error)} />
        <Button label="Try again" onPress={() => void child.refetch()} />
        <Button label="Back" variant="quiet" onPress={onBack} />
      </Screen>
    );
  }

  const caregiverList = caregivers.data?.items ?? [];
  // Deleting a child is a workspace-owner action, not a per-child manager one (data-contract §7).
  const isWorkspaceOwner =
    bootstrap.data?.workspaces.find((candidate) => candidate.id === child.data.workspaceId)
      ?.appRole === "owner";

  return (
    <Screen scroll>
      <Text className="text-2xl font-semibold text-primary dark:text-primary-dark">
        {child.data.name}
      </Text>

      <View className="gap-xs">
        <Text className="text-sm font-semibold text-muted dark:text-muted-dark">Birthdate</Text>
        {/* An unrecorded birthdate is stated as unknown; it is never filled with a stand-in date. */}
        <Text className="text-base text-primary dark:text-primary-dark">
          {child.data.birthdate ?? "Not recorded"}
        </Text>
      </View>

      <View className="gap-xs">
        <Text className="text-sm font-semibold text-muted dark:text-muted-dark">Your access</Text>
        <Text className="text-base text-primary dark:text-primary-dark">
          {describeChildPermission(child.data.permission)}
        </Text>
      </View>

      {canManageCaregivers ? (
        <>
          <Text className="text-lg font-semibold text-primary dark:text-primary-dark">
            Caregivers
          </Text>

          {caregivers.isPending ? (
            <StatusMessage tone="info" message="Loading caregivers…" />
          ) : null}

          {caregivers.isError ? (
            <>
              <StatusMessage tone="error" message={describeError(caregivers.error)} />
              <Button label="Try again" onPress={() => void caregivers.refetch()} />
            </>
          ) : null}

          {caregivers.isSuccess && caregiverList.length === 0 ? (
            <StatusMessage
              tone="info"
              message="Nobody else has access to this child yet. Invite a caregiver to share the day."
            />
          ) : null}

          {caregiverList.map((caregiver) => (
            <View
              key={caregiver.userId}
              className="gap-xs rounded-md border border-border bg-surface px-lg py-md dark:border-border-dark dark:bg-surface-dark"
            >
              <Text className="text-base font-semibold text-primary dark:text-primary-dark">
                {caregiver.displayName ?? "Name not shared"}
              </Text>
              <Text className="text-sm text-muted dark:text-muted-dark">
                {relationshipLabels[caregiver.relationship]} ·{" "}
                {caregiver.status === "active" ? "Active" : "Revoked"}
              </Text>
            </View>
          ))}

          <StatusMessage
            tone="info"
            message="You manage caregivers for this child. Send an invitation from the invitations screen to grant access; changing an existing grant arrives with the child dashboard."
          />
        </>
      ) : null}

      {isWorkspaceOwner ? (
        <Button
          label="Delete this child"
          variant="secondary"
          onPress={() => onOpenSettings(childId)}
          accessibilityHint="Opens privacy and data, where deletion is confirmed by typing the child's name"
          testID="child-profile-delete"
        />
      ) : null}

      <Button label="Back" variant="quiet" onPress={onBack} />
    </Screen>
  );
}
