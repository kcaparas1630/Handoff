import { Text, View } from "react-native";

import { Button } from "@handoff/ui";

import type { DashboardHeaderProps } from "./types/care-dashboard-screen";

/** Identity and care context stay at the top of every capture and review action (section 1). */
export function DashboardHeader({
  childName,
  workspaceName,
  caringLine,
  lastSyncedLine,
  onOpenProfile,
}: DashboardHeaderProps) {
  return (
    <View className="gap-xs">
      <View className="flex-row items-center justify-between gap-md">
        <Text className="flex-1 text-2xl font-semibold text-primary dark:text-primary-dark">
          {childName}
        </Text>
        <Text className="text-sm text-muted dark:text-muted-dark">{workspaceName}</Text>
      </View>
      <Text className="text-base text-primary dark:text-primary-dark">{caringLine}</Text>
      <Text className="text-sm text-muted dark:text-muted-dark">{lastSyncedLine}</Text>
      <Button
        label="Profile and caregivers"
        variant="quiet"
        onPress={onOpenProfile}
        accessibilityHint={`Opens ${childName}'s profile`}
        testID="dashboard-open-profile"
      />
    </View>
  );
}
