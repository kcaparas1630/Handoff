import { Text } from "react-native";

/** One field message. Absent when the field is fine, so nothing implies an error by colour alone. */
export function FieldError({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      className="text-sm font-semibold text-accent dark:text-accent-dark"
    >
      {message}
    </Text>
  );
}
