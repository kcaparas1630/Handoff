import { useChild, useChildCaregivers } from "@handoff/api-client";
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

export function ChildProfileScreen({ childId, onBack }: ChildProfileScreenProps) {
  const child = useChild(childId);
  const caregivers = useChildCaregivers(childId);

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

      <Text className="text-lg font-semibold text-primary dark:text-primary-dark">Caregivers</Text>

      {caregivers.isPending ? <StatusMessage tone="info" message="Loading caregivers…" /> : null}

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

      {child.data.permission === "manager" ? (
        <StatusMessage
          tone="info"
          message="You manage caregivers for this child. Send an invitation from the invitations screen to grant access; changing an existing grant arrives with the child dashboard."
        />
      ) : null}

      <Button label="Back" variant="quiet" onPress={onBack} />
    </Screen>
  );
}
