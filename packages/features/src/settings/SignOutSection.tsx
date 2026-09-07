import { useAuth } from "@clerk/clerk-expo";
import { Button, StatusMessage } from "@handoff/ui";
import { useState } from "react";
import { View } from "react-native";

import { useSignOutWithOutboxNotice } from "../auth/useSignOutWithOutboxNotice";
import { describeError } from "../shared/lib/describe-error";
import type { SignOutSectionProps } from "./types/privacy-settings-screen";

/**
 * Local files are removed before Clerk's session ends, so the next account cannot inherit an
 * upload. The notice states what is about to be lost rather than discarding it silently.
 */
export function SignOutSection({ onSignedOut }: SignOutSectionProps) {
  const { signOut } = useAuth();
  const notice = useSignOutWithOutboxNotice();
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  function performSignOut(): void {
    setIsBusy(true);
    setErrorMessage(null);
    void notice
      .confirmSignOut()
      .then(() => signOut())
      .then(() => onSignedOut())
      .catch((error: unknown) => setErrorMessage(describeError(error)))
      .finally(() => setIsBusy(false));
  }

  return (
    <View className="gap-md" testID="sign-out-section">
      {notice.noticeMessage === null ? null : (
        <StatusMessage
          tone="warning"
          message={notice.noticeMessage}
          testID="sign-out-pending-notice"
        />
      )}

      {errorMessage === null ? null : <StatusMessage tone="error" message={errorMessage} />}

      {/* A pending recording is worth a second tap; with nothing unsent, one is enough. */}
      {notice.pendingCount > 0 && !isConfirming ? (
        <Button
          label="Sign out"
          variant="secondary"
          onPress={() => setIsConfirming(true)}
          testID="sign-out"
        />
      ) : (
        <Button
          label={notice.pendingCount > 0 ? "Sign out and delete those files" : "Sign out"}
          variant="secondary"
          onPress={performSignOut}
          isLoading={isBusy}
          testID={notice.pendingCount > 0 ? "sign-out-confirm" : "sign-out"}
        />
      )}

      {isConfirming ? (
        <Button label="Stay signed in" variant="quiet" onPress={() => setIsConfirming(false)} />
      ) : null}
    </View>
  );
}
