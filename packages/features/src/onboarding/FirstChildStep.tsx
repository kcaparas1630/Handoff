import { useCreateChild } from "@handoff/api-client";
import { birthdateSchema } from "@handoff/contracts";
import type { CreateChildRequest } from "@handoff/contracts";
import { Button, Screen, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { Text } from "react-native";

import { LabeledTextInput } from "../shared/LabeledTextInput";
import { describeError } from "../shared/lib/describe-error";
import type { FirstChildStepProps } from "./types/onboarding-screen";

export function FirstChildStep({ workspace, onCompleted }: FirstChildStepProps) {
  const createChild = useCreateChild(workspace.id);
  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit() {
    setErrorMessage(null);
    const trimmedBirthdate = birthdate.trim();
    if (trimmedBirthdate.length > 0 && !birthdateSchema.safeParse(trimmedBirthdate).success) {
      setErrorMessage("Enter the birthdate as YYYY-MM-DD, or leave it blank.");
      return;
    }
    // An unrecorded birthdate stays absent instead of becoming a placeholder date.
    const request: CreateChildRequest =
      trimmedBirthdate.length === 0
        ? { name: name.trim() }
        : { name: name.trim(), birthdate: trimmedBirthdate };
    try {
      const child = await createChild.mutateAsync(request);
      onCompleted(workspace.id, child.id);
    } catch (error) {
      setErrorMessage(describeError(error));
    }
  }

  return (
    <Screen scroll>
      <Text className="text-sm font-semibold text-muted dark:text-muted-dark">Step 2 of 2</Text>
      <Text className="text-2xl font-semibold text-primary dark:text-primary-dark">
        Add a child to {workspace.name}
      </Text>
      <Text className="text-base text-muted dark:text-muted-dark">
        Once the child exists you can invite the people who care for them.
      </Text>

      {errorMessage ? <StatusMessage tone="error" message={errorMessage} /> : null}

      <LabeledTextInput
        label="Child's name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        isEditable={!createChild.isPending}
        testID="onboarding-child-name"
      />
      <LabeledTextInput
        label="Birthdate (optional)"
        value={birthdate}
        onChangeText={setBirthdate}
        placeholder="YYYY-MM-DD"
        hint="Leave it blank if you would rather not record it."
        keyboardType="number-pad"
        autoCapitalize="none"
        isEditable={!createChild.isPending}
        testID="onboarding-child-birthdate"
      />
      <Button
        label="Add child"
        onPress={() => void submit()}
        isDisabled={name.trim().length === 0}
        isLoading={createChild.isPending}
        testID="onboarding-create-child"
      />
    </Screen>
  );
}
