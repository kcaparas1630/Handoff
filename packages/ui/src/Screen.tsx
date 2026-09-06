import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ScreenProps } from "./types/screen";

const contentPadding = "px-lg py-lg";

export function Screen({ children, scroll = false, contentClassName = "", testID }: ScreenProps) {
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      className="flex-1 bg-background dark:bg-background-dark"
      testID={testID}
    >
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={`${contentPadding} gap-lg ${contentClassName}`}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View className={`flex-1 gap-lg ${contentPadding} ${contentClassName}`}>{children}</View>
      )}
    </SafeAreaView>
  );
}
