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
  isMultiline = false,
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
        multiline={isMultiline}
        editable={isEditable}
        testID={testID}
        className={`rounded-md border border-border bg-surface px-md py-md text-base text-primary dark:border-border-dark dark:bg-surface-dark dark:text-primary-dark ${isMultiline ? "min-h-[96px]" : "min-h-touch"}`}
      />
      {hint ? <Text className="text-sm text-muted dark:text-muted-dark">{hint}</Text> : null}
    </View>
  );
}
