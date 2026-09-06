import { Children } from "react";
import { Text, View } from "react-native";

import type { AttachmentStripProps } from "./types/attachment-tile";

// architecture.md section 6 allows at most three attachments per capture. The server enforces it;
// the strip refuses to draw a fourth so a stale count can never look like more room than there is.
const maxTiles = 3;

export function AttachmentStrip({ children, label, className = "", testID }: AttachmentStripProps) {
  const tiles = Children.toArray(children).slice(0, maxTiles);
  if (tiles.length === 0) return null;

  return (
    <View className={`gap-sm ${className}`} testID={testID}>
      <Text className="text-sm font-semibold text-muted dark:text-muted-dark">{label}</Text>
      <View accessibilityRole="list" className="flex-row flex-wrap gap-sm">
        {tiles}
      </View>
    </View>
  );
}
