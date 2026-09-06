import { useSignIn, useSignUp } from "@clerk/clerk-expo";
import { Button, Screen, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { Text } from "react-native";

import { ChoiceChips } from "../shared/ChoiceChips";
import { LabeledTextInput } from "../shared/LabeledTextInput";
import { describeError } from "../shared/lib/describe-error";
import type { ChoiceOption } from "../shared/types/choice-chips";
import type { SignInMode, SignInScreenProps, SignInStep } from "./types/sign-in-screen";

const flavorIntros = {
  parents: "Sign in to follow your child's day and hand off care.",
  daycare: "Sign in to your daycare roster and share the day with families.",
} as const;

const modeOptions: readonly ChoiceOption<SignInMode>[] = [
  { value: "sign-in", label: "I have an account" },
  { value: "sign-up", label: "I am new here" },
];

export function SignInScreen({ flavor, onSignedIn }: SignInScreenProps) {
  const signInFlow = useSignIn();
  const signUpFlow = useSignUp();

  const [mode, setMode] = useState<SignInMode>("sign-in");
  const [step, setStep] = useState<SignInStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const isReady = signInFlow.isLoaded && signUpFlow.isLoaded;

  async function sendCode() {
    if (!signInFlow.isLoaded || !signUpFlow.isLoaded) return;
    setErrorMessage(null);
    setIsBusy(true);
    try {
      if (mode === "sign-up") {
        await signUpFlow.signUp.create({ emailAddress: email.trim() });
        await signUpFlow.signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      } else {
        const attempt = await signInFlow.signIn.create({ identifier: email.trim() });
        const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === "email_code");
        if (!factor) {
          throw new Error(
            "This account does not accept email codes. Contact your workspace owner.",
          );
        }
        await signInFlow.signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: factor.emailAddressId,
        });
      }
      setStep("code");
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function verifyCode() {
    if (!signInFlow.isLoaded || !signUpFlow.isLoaded) return;
    setErrorMessage(null);
    setIsBusy(true);
    try {
      if (mode === "sign-up") {
        const result = await signUpFlow.signUp.attemptEmailAddressVerification({
          code: code.trim(),
        });
        if (result.status !== "complete" || result.createdSessionId === null) {
          throw new Error("That code did not complete sign-up. Request a new code and try again.");
        }
        await signUpFlow.setActive({ session: result.createdSessionId });
      } else {
        const result = await signInFlow.signIn.attemptFirstFactor({
          strategy: "email_code",
          code: code.trim(),
        });
        if (result.status !== "complete" || result.createdSessionId === null) {
          throw new Error("That code did not complete sign-in. Request a new code and try again.");
        }
        await signInFlow.setActive({ session: result.createdSessionId });
      }
      onSignedIn();
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsBusy(false);
    }
  }

  function restart() {
    setStep("email");
    setCode("");
    setErrorMessage(null);
  }

  return (
    <Screen scroll>
      <Text className="text-2xl font-semibold text-primary dark:text-primary-dark">
        {flavorIntros[flavor]}
      </Text>
      <Text className="text-base text-muted dark:text-muted-dark">
        Handoff emails you a six-digit code. There is no password to remember.
      </Text>

      {errorMessage ? <StatusMessage tone="error" message={errorMessage} /> : null}
      {!isReady ? <StatusMessage tone="info" message="Preparing sign-in…" /> : null}

      {step === "email" ? (
        <>
          <ChoiceChips
            label="How are you signing in?"
            options={modeOptions}
            selectedValues={[mode]}
            onSelect={setMode}
          />
          <LabeledTextInput
            label="Email address"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            isEditable={!isBusy}
            testID="sign-in-email"
          />
          <Button
            label="Email me a code"
            onPress={() => void sendCode()}
            isDisabled={!isReady || email.trim().length === 0}
            isLoading={isBusy}
            testID="sign-in-send-code"
          />
        </>
      ) : (
        <>
          <StatusMessage tone="info" message={`Enter the code sent to ${email.trim()}.`} />
          <LabeledTextInput
            label="Six-digit code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoCapitalize="none"
            autoComplete="one-time-code"
            isEditable={!isBusy}
            testID="sign-in-code"
          />
          <Button
            label="Continue"
            onPress={() => void verifyCode()}
            isDisabled={!isReady || code.trim().length === 0}
            isLoading={isBusy}
            testID="sign-in-verify"
          />
          <Button
            label="Use a different email"
            variant="quiet"
            onPress={restart}
            isDisabled={isBusy}
          />
        </>
      )}
    </Screen>
  );
}
