import { useInvitations, useRevokeInvitation } from "@handoff/api-client";
import { Button, Screen, StatusMessage } from "@handoff/ui";
import { Text, View } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import { InviteForm } from "./InviteForm";
import { describeInvitationStatus, isRevocableStatus } from "./lib/invitation-status-label";
import type { InvitationsScreenProps } from "./types/invitations-screen";

const roleLabels = {
  owner: "Owner",
  staff: "Staff",
  caregiver: "Caregiver",
  guardian: "Family guardian",
} as const;

export function InvitationsScreen({ flavor, workspaceId, onBack }: InvitationsScreenProps) {
  const invitations = useInvitations(workspaceId);
  const revokeInvitation = useRevokeInvitation();

  const items = invitations.data?.items ?? [];

  return (
    <Screen scroll>
      <Text className="text-2xl font-semibold text-primary dark:text-primary-dark">
        Invitations
      </Text>
      <Text className="text-base text-muted dark:text-muted-dark">
        An invitation grants access to the children you choose, not to the whole workspace.
      </Text>

      <InviteForm flavor={flavor} workspaceId={workspaceId} />

      <Text className="text-lg font-semibold text-primary dark:text-primary-dark">
        Sent invitations
      </Text>

      {invitations.isPending ? <StatusMessage tone="info" message="Loading invitations…" /> : null}

      {invitations.isError ? (
        <>
          <StatusMessage tone="error" message={describeError(invitations.error)} />
          <Button label="Try again" onPress={() => void invitations.refetch()} />
        </>
      ) : null}

      {revokeInvitation.isError ? (
        <StatusMessage tone="error" message={describeError(revokeInvitation.error)} />
      ) : null}

      {invitations.isSuccess && items.length === 0 ? (
        <StatusMessage
          tone="info"
          message="No invitations yet. The people you invite show up here with their status."
        />
      ) : null}

      {items.map((invitation) => (
        <View
          key={invitation.id}
          className="gap-sm rounded-md border border-border bg-surface px-lg py-md dark:border-border-dark dark:bg-surface-dark"
        >
          {/* The invitee's address is deliberately absent from the list DTO. */}
          <Text className="text-base font-semibold text-primary dark:text-primary-dark">
            {roleLabels[invitation.intendedAppRole]} ·{" "}
            {invitation.childGrants.length === 1
              ? "1 child"
              : `${String(invitation.childGrants.length)} children`}
          </Text>
          <Text className="text-sm text-muted dark:text-muted-dark">
            {describeInvitationStatus(invitation.status)}
          </Text>
          {isRevocableStatus(invitation.status) ? (
            <Button
              label="Revoke invitation"
              variant="secondary"
              onPress={() => revokeInvitation.mutate({ invitationId: invitation.id, workspaceId })}
              isLoading={
                revokeInvitation.isPending &&
                revokeInvitation.variables?.invitationId === invitation.id
              }
              testID={`invitation-revoke-${invitation.id}`}
            />
          ) : null}
        </View>
      ))}

      <Button label="Back" variant="quiet" onPress={onBack} />
    </Screen>
  );
}
