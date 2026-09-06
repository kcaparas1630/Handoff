import { Image, Pressable, Text, View } from "react-native";

import type { AttachmentTileProps, AttachmentTileStatus } from "./types/attachment-tile";

// Glyph plus a written label, so no state is carried by colour alone.
const stateGlyphs = { local: "\u{1F4F1}", pending: "\u{23F3}", loading: "…", failed: "×" } as const;

const stateLabels = {
  local: "On this phone",
  pending: "Awaiting validation",
  loading: "Loading",
  failed: "Could not load",
} as const;

const kindNouns = { image: "Photo", video: "Video" } as const;

// A square tile keeps a mixed row of photos and videos on one grid.
const tileClassName =
  "h-24 w-24 items-center justify-center gap-xs overflow-hidden rounded-md border border-border bg-surface p-xs dark:border-border-dark dark:bg-surface-dark";

export function AttachmentTile({
  status,
  positionLabel,
  onPress,
  onRetry,
  testID,
}: AttachmentTileProps) {
  const spoken = `${positionLabel}, ${describe(status)}`;

  if (status.state === "ready") {
    return (
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={spoken}
        accessibilityHint={status.kind === "video" ? "Plays this video" : "Opens this photo"}
        onPress={onPress}
        className={tileClassName}
        testID={testID}
      >
        {status.kind === "image" ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: status.uri }}
            resizeMode="cover"
            className="h-full w-full"
          />
        ) : (
          <>
            <Text className="text-2xl text-primary dark:text-primary-dark">▶</Text>
            <Text className="text-center text-sm text-primary dark:text-primary-dark">
              Play video
            </Text>
          </>
        )}
      </Pressable>
    );
  }

  const body = (
    <>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        className="text-xl text-muted dark:text-muted-dark"
      >
        {stateGlyphs[status.state]}
      </Text>
      <Text className="text-center text-sm text-muted dark:text-muted-dark">
        {stateLabels[status.state]}
      </Text>
    </>
  );

  if (status.state === "failed" && onRetry !== undefined) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint="Tries this attachment again"
        onPress={onRetry}
        className={tileClassName}
        testID={testID}
      >
        {body}
        <Text className="text-center text-sm font-semibold text-primary dark:text-primary-dark">
          Try again
        </Text>
      </Pressable>
    );
  }

  return (
    <View accessible accessibilityLabel={spoken} className={tileClassName} testID={testID}>
      {body}
    </View>
  );
}

function describe(status: AttachmentTileStatus): string {
  const noun = kindNouns[status.kind].toLowerCase();
  if (status.state === "ready") return `${noun}, shared`;
  if (status.state === "failed") return `${noun}, ${status.message}`;
  return `${noun}, ${stateLabels[status.state].toLowerCase()}`;
}
