import { Text, TextInput, View } from "react-native";

import type { LabeledTextInputProps } from "./types/labeled-text-input";

export function LabeledTextInput({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  keyboardType = "default",
  autoCapitalize = "sentences",
  autoComplete = "off",
  isEditable = true,
  testID,
}: LabeledTextInputProps) {
  return (
    <View className="gap-xs">
      <Text className="text-sm font-semibold text-primary dark:text-primary-dark">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={false}
        editable={isEditable}
        testID={testID}
        className="min-h-touch rounded-md border border-border bg-surface px-md py-md text-base text-primary dark:border-border-dark dark:bg-surface-dark dark:text-primary-dark"
      />
      {hint ? <Text className="text-sm text-muted dark:text-muted-dark">{hint}</Text> : null}
    </View>
  );
}
