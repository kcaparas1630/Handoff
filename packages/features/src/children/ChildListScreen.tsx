import { useBootstrap, useChildren } from "@handoff/api-client";
import { useSelectedContext } from "@handoff/mobile";
import { Button, ChildCard, Screen, StatusMessage } from "@handoff/ui";
import { useEffect } from "react";
import { Text, View } from "react-native";

import { describeError } from "../shared/lib/describe-error";
import { describeChildPermission } from "./lib/permission-label";
import type { ChildListScreenProps } from "./types/child-list-screen";

export function ChildListScreen({
  flavor,
  onSelectChild,
  onAddChild,
  onInvite,
  onNeedsOnboarding,
}: ChildListScreenProps) {
  const bootstrap = useBootstrap();
  const selectedWorkspaceId = useSelectedContext((state) => state.selectedWorkspaceId);
  const selectWorkspace = useSelectedContext((state) => state.selectWorkspace);
  const selectChild = useSelectedContext((state) => state.selectChild);

  const workspace =
    bootstrap.data?.workspaces.find((candidate) => candidate.id === selectedWorkspaceId) ?? null;
  const children = useChildren(workspace?.id ?? null);

  useEffect(() => {
    const workspaces = bootstrap.data?.workspaces;
    if (workspaces === undefined) return;
    if (workspaces.length === 0) {
      onNeedsOnboarding();
      return;
    }
    if (workspaces.some((candidate) => candidate.id === selectedWorkspaceId)) return;
    const first = workspaces[0];
    if (first !== undefined) selectWorkspace(first.id);
  }, [bootstrap.data, selectedWorkspaceId, selectWorkspace, onNeedsOnboarding]);

  if (bootstrap.isPending) {
    return (
      <Screen>
        <StatusMessage tone="info" message="Loading your workspaces…" />
      </Screen>
    );
  }

  if (bootstrap.isError) {
    return (
      <Screen>
        <StatusMessage tone="error" message={describeError(bootstrap.error)} />
        <Button label="Try again" onPress={() => void bootstrap.refetch()} />
      </Screen>
    );
  }

  if (workspace === null) {
    return (
      <Screen>
        <StatusMessage tone="info" message="Choosing a workspace…" />
        <Button label="Set up a workspace" variant="secondary" onPress={onNeedsOnboarding} />
      </Screen>
    );
  }

  // UI visibility is not authorization: only a workspace-wide owner is offered the create action,
  // because a child that does not exist yet cannot carry a per-child grant (data-contract §7).
  const canAddChild = workspace.appRole === "owner";
  const items = children.data?.items ?? [];
  const canInvite = canAddChild || items.some((child) => child.permission === "manager");
  const isDaycare = flavor === "daycare";

  return (
    <Screen scroll>
      <View className="gap-xs">
        <Text className="text-2xl font-semibold text-primary dark:text-primary-dark">
          {isDaycare ? workspace.name : "Your children"}
        </Text>
        <Text className="text-base text-muted dark:text-muted-dark">
          {isDaycare ? "Daycare roster" : workspace.name}
        </Text>
      </View>

      {children.isPending ? <StatusMessage tone="info" message="Loading children…" /> : null}

      {children.isError ? (
        <>
          <StatusMessage tone="error" message={describeError(children.error)} />
          <Button label="Try again" onPress={() => void children.refetch()} />
        </>
      ) : null}

      {children.isSuccess && items.length === 0 ? (
        <View className="gap-md">
          <StatusMessage
            tone="info"
            message={
              isDaycare
                ? "No children on this roster yet. Add the first child, or invite a family to join."
                : "No children here yet. Add your first child and their day starts showing up here."
            }
          />
          {canAddChild ? null : (
            <Text className="text-base text-muted dark:text-muted-dark">
              Ask the workspace owner to add a child, then it appears here.
            </Text>
          )}
        </View>
      ) : null}

      {items.map((child) => (
        <ChildCard
          key={child.id}
          name={child.name}
          secondaryLine={isDaycare ? describeChildPermission(child.permission) : workspace.name}
          onPress={() => {
            selectChild(child.id);
            onSelectChild(child.id);
          }}
          testID={`child-card-${child.id}`}
        />
      ))}

      {children.data?.nextCursor != null ? (
        <StatusMessage
          tone="info"
          message="Showing the first page of children. Paging through a longer roster arrives with the child dashboard."
        />
      ) : null}

      {canAddChild ? (
        <Button label="Add child" onPress={onAddChild} testID="child-list-add-child" />
      ) : null}
      {canInvite ? (
        <Button
          label="Invite a caregiver"
          variant="secondary"
          onPress={onInvite}
          testID="child-list-invite"
        />
      ) : null}
    </Screen>
  );
}
