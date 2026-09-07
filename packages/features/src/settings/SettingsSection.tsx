import { Text, View } from "react-native";

import type { SettingsSectionProps } from "./types/privacy-settings-screen";

/** One labelled block of the privacy screen. Heading, one plain sentence, then the controls. */
export function SettingsSection({ title, description, children, testID }: SettingsSectionProps) {
  return (
    <View className="gap-md" testID={testID}>
      <Text className="text-lg font-semibold text-primary dark:text-primary-dark">{title}</Text>
      <Text className="text-sm text-muted dark:text-muted-dark">{description}</Text>
      {children}
    </View>
  );
}
