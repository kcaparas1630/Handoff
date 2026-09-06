import { Button, StatusMessage } from "@handoff/ui";
import { View } from "react-native";

import type { CaptureFailureActionsProps } from "./types/review";

/** What a caregiver can do about a recording that could not be processed or sent. */
export function CaptureFailureActions({
  message,
  canRetry,
  isRetrying,
  onRetry,
  onEnterManually,
}: CaptureFailureActionsProps) {
  return (
    <View className="gap-md">
      <StatusMessage tone="error" message={message} />
      {canRetry ? (
        <Button label="Try again" onPress={onRetry} isLoading={isRetrying} testID="review-retry" />
      ) : null}
      <Button label="Enter manually" variant="secondary" onPress={onEnterManually} />
    </View>
  );
}
