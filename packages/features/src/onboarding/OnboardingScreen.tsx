import { useOrganizationList } from "@clerk/clerk-expo";
import { useBootstrap, useCreateWorkspace } from "@handoff/api-client";
import type { WorkspaceDto } from "@handoff/contracts";
import { useSelectedContext } from "@handoff/mobile";
import { Button, Screen, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { Text } from "react-native";

import { LabeledTextInput } from "../shared/LabeledTextInput";
import { describeError } from "../shared/lib/describe-error";
import { FirstChildStep } from "./FirstChildStep";
import type { OnboardingScreenProps } from "./types/onboarding-screen";

const flavorCopy = {
  parents: { heading: "Create your family workspace", hint: "For example, the Ortega family." },
  daycare: { heading: "Create your daycare workspace", hint: "For example, Maple Daycare." },
} as const;

export function OnboardingScreen({ flavor, onCompleted }: OnboardingScreenProps) {
  const bootstrap = useBootstrap();
  const createWorkspace = useCreateWorkspace();
  const organizationList = useOrganizationList();
  const selectWorkspace = useSelectedContext((state) => state.selectWorkspace);
  const selectedWorkspaceId = useSelectedContext((state) => state.selectedWorkspaceId);

  const [workspaceName, setWorkspaceName] = useState("");
  // Hermes can leave the resolved zone undefined, so the detected value is only a pre-filled draft.
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
  );
  const [createdWorkspace, setCreatedWorkspace] = useState<WorkspaceDto | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const workspaces = bootstrap.data?.workspaces ?? [];
  const activeWorkspace =
    createdWorkspace ??
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
    (workspaces.length === 1 ? workspaces[0] : undefined) ??
    null;

  async function createWorkspaceStep() {
    if (!organizationList.isLoaded) return;
    setErrorMessage(null);
    try {
      const organization = await organizationList.createOrganization({
        name: workspaceName.trim(),
      });
      // Make it the active organization so the next Clerk token carries this membership.
      await organizationList.setActive({ organization: organization.id });
      const workspace = await createWorkspace.mutateAsync({
        clerkOrgId: organization.id,
        kind: flavor === "daycare" ? "daycare" : "household",
        name: workspaceName.trim(),
        timezone: timezone.trim(),
      });
      selectWorkspace(workspace.id);
      setCreatedWorkspace(workspace);
    } catch (error) {
      setErrorMessage(describeError(error));
    }
  }

  if (bootstrap.isPending) {
    return (
      <Screen>
        <StatusMessage tone="info" message="Checking which workspaces you already belong to…" />
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

  if (activeWorkspace !== null) {
    return <FirstChildStep workspace={activeWorkspace} onCompleted={onCompleted} />;
  }

  const copy = flavorCopy[flavor];

  return (
    <Screen scroll>
      <Text className="text-sm font-semibold text-muted dark:text-muted-dark">Step 1 of 2</Text>
      <Text className="text-2xl font-semibold text-primary dark:text-primary-dark">
        {copy.heading}
      </Text>
      <Text className="text-base text-muted dark:text-muted-dark">
        The workspace holds your children and everyone you invite to care for them.
      </Text>

      {errorMessage ? <StatusMessage tone="error" message={errorMessage} /> : null}

      <LabeledTextInput
        label="Workspace name"
        value={workspaceName}
        onChangeText={setWorkspaceName}
        placeholder={copy.hint}
        autoCapitalize="words"
        isEditable={!createWorkspace.isPending}
        testID="onboarding-workspace-name"
      />
      <LabeledTextInput
        label="Time zone"
        value={timezone}
        onChangeText={setTimezone}
        hint="Detected from this device. Care times are read in this zone."
        autoCapitalize="none"
        isEditable={!createWorkspace.isPending}
        testID="onboarding-timezone"
      />
      <Button
        label="Create workspace"
        onPress={() => void createWorkspaceStep()}
        isDisabled={
          !organizationList.isLoaded ||
          workspaceName.trim().length === 0 ||
          timezone.trim().length === 0
        }
        isLoading={createWorkspace.isPending}
        testID="onboarding-create-workspace"
      />
    </Screen>
  );
}
