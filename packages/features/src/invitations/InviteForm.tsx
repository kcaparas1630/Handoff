import { useChildren, useCreateInvitation } from "@handoff/api-client";
import { inviteeEmailSchema } from "@handoff/contracts";
import type { AppRole, CaregiverRelationship, ChildPermission } from "@handoff/contracts";
import { Button, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { Text, View } from "react-native";

import { ChoiceChips } from "../shared/ChoiceChips";
import { LabeledTextInput } from "../shared/LabeledTextInput";
import { describeError } from "../shared/lib/describe-error";
import type { ChoiceOption } from "../shared/types/choice-chips";
import type { InviteFormProps } from "./types/invitations-screen";

// The two flavors offer different roles; owner is never invitable (data-contract.md section 7).
const roleOptionsByFlavor = {
  parents: [{ value: "caregiver", label: "Caregiver" }],
  daycare: [
    { value: "staff", label: "Staff" },
    { value: "guardian", label: "Family guardian" },
  ],
} as const;

const relationshipOptions: readonly ChoiceOption<CaregiverRelationship>[] = [
  { value: "parent", label: "Parent" },
  { value: "relative", label: "Relative" },
  { value: "caregiver", label: "Caregiver" },
  { value: "other", label: "Other" },
];

const permissionOptions: readonly ChoiceOption<ChildPermission>[] = [
  { value: "reader", label: "Read only" },
  { value: "contributor", label: "Can record care" },
  { value: "manager", label: "Can manage caregivers" },
];

export function InviteForm({ flavor, workspaceId }: InviteFormProps) {
  const children = useChildren(workspaceId);
  const createInvitation = useCreateInvitation(workspaceId);

  const roleOptions = roleOptionsByFlavor[flavor];
  const [email, setEmail] = useState("");
  const [appRole, setAppRole] = useState<AppRole>(flavor === "daycare" ? "staff" : "caregiver");
  const [relationship, setRelationship] = useState<CaregiverRelationship>("caregiver");
  const [permission, setPermission] = useState<ChildPermission>("contributor");
  const [childIds, setChildIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const childOptions = (children.data?.items ?? []).map((child) => ({
    value: child.id,
    label: child.name,
  }));

  function toggleChild(childId: string) {
    setChildIds((current) =>
      current.includes(childId)
        ? current.filter((candidate) => candidate !== childId)
        : [...current, childId],
    );
  }

  async function submit() {
    setErrorMessage(null);
    setMessage(null);
    const parsedEmail = inviteeEmailSchema.safeParse(email);
    if (!parsedEmail.success) {
      setErrorMessage("Enter a valid email address for the person you are inviting.");
      return;
    }
    if (childIds.length === 0) {
      setErrorMessage("Choose at least one child this person may care for.");
      return;
    }
    try {
      await createInvitation.mutateAsync({
        email: parsedEmail.data,
        intendedAppRole: appRole,
        childGrants: childIds.map((childId) => ({ childId, relationship, permission })),
      });
      // The list refetches from the server; nothing is shown as invited before it responds.
      setMessage("Invitation sent. It appears below once the server confirms it.");
      setEmail("");
      setChildIds([]);
    } catch (error) {
      setErrorMessage(describeError(error));
    }
  }

  return (
    <View className="gap-md">
      <Text className="text-lg font-semibold text-primary dark:text-primary-dark">
        Invite someone
      </Text>

      {errorMessage ? <StatusMessage tone="error" message={errorMessage} /> : null}
      {message ? <StatusMessage tone="success" message={message} /> : null}

      <LabeledTextInput
        label="Email address"
        value={email}
        onChangeText={setEmail}
        placeholder="caregiver@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        isEditable={!createInvitation.isPending}
        testID="invite-email"
      />

      <ChoiceChips
        label="Role in this workspace"
        options={roleOptions}
        selectedValues={[appRole]}
        onSelect={setAppRole}
        testID="invite-role"
      />

      <ChoiceChips
        label="Relationship to the child"
        options={relationshipOptions}
        selectedValues={[relationship]}
        onSelect={setRelationship}
        testID="invite-relationship"
      />

      <ChoiceChips
        label="What they may do"
        options={permissionOptions}
        selectedValues={[permission]}
        onSelect={setPermission}
        testID="invite-permission"
      />

      <ChoiceChips
        label="Children they may care for"
        options={childOptions}
        selectedValues={childIds}
        onSelect={toggleChild}
        emptyMessage={
          children.isPending ? "Loading children…" : "Add a child before inviting someone."
        }
        testID="invite-children"
      />

      <Button
        label="Send invitation"
        onPress={() => void submit()}
        isDisabled={email.trim().length === 0 || childIds.length === 0}
        isLoading={createInvitation.isPending}
        testID="invite-submit"
      />
    </View>
  );
}
