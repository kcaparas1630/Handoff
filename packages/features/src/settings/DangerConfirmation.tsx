import { Button, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { Text, View } from "react-native";

import { LabeledTextInput } from "../shared/LabeledTextInput";
import type { DangerConfirmationProps } from "./types/privacy-settings-screen";

type Step = "idle" | "acknowledging" | "typing";

/**
 * A deletion is not one tap. The first tap only shows what would be lost; the caregiver then types
 * the record's own name, which cannot be produced by a mis-tap or a screen reader gesture.
 */
export function DangerConfirmation({
  armLabel,
  heading,
  consequences,
  requiresAcknowledgement = false,
  acknowledgementLabel = "I understand",
  confirmPhrase,
  confirmPhraseLabel,
  confirmLabel,
  isBusy,
  errorMessage,
  onConfirm,
  testIDPrefix,
}: DangerConfirmationProps) {
  const [step, setStep] = useState<Step>("idle");
  const [typed, setTyped] = useState("");

  const matches = typed.trim().toLocaleLowerCase() === confirmPhrase.trim().toLocaleLowerCase();

  function cancel(): void {
    setStep("idle");
    setTyped("");
  }

  if (step === "idle") {
    return (
      <Button
        label={armLabel}
        variant="secondary"
        onPress={() => setStep(requiresAcknowledgement ? "acknowledging" : "typing")}
        testID={`${testIDPrefix}-open`}
      />
    );
  }

  return (
    <View
      className="gap-md rounded-md border border-accent bg-surface px-lg py-lg dark:border-accent-dark dark:bg-surface-dark"
      testID={`${testIDPrefix}-panel`}
    >
      <Text className="text-base font-semibold text-primary dark:text-primary-dark">{heading}</Text>
      {consequences.map((line) => (
        <Text key={line} className="text-sm text-primary dark:text-primary-dark">
          • {line}
        </Text>
      ))}

      {errorMessage === null ? null : <StatusMessage tone="error" message={errorMessage} />}

      {step === "acknowledging" ? (
        <>
          <Button
            label={acknowledgementLabel}
            variant="secondary"
            onPress={() => setStep("typing")}
            testID={`${testIDPrefix}-acknowledge`}
          />
          <Button label="Cancel" variant="quiet" onPress={cancel} />
        </>
      ) : (
        <>
          <LabeledTextInput
            label={confirmPhraseLabel}
            value={typed}
            onChangeText={setTyped}
            placeholder={confirmPhrase}
            autoCapitalize="none"
            hint={`Type ${confirmPhrase} exactly to enable the button below.`}
            testID={`${testIDPrefix}-phrase`}
          />
          <Button
            label={confirmLabel}
            onPress={onConfirm}
            isDisabled={!matches}
            isLoading={isBusy}
            {...(matches
              ? {}
              : { accessibilityHint: `Enabled once you type ${confirmPhrase} in the field above` })}
            testID={`${testIDPrefix}-confirm`}
          />
          <Button label="Cancel" variant="quiet" onPress={cancel} />
        </>
      )}
    </View>
  );
}
