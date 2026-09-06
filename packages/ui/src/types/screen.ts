import type { ReactNode } from "react";

export type ScreenProps = {
  children: ReactNode;
  /** Wrap the content in a vertical ScrollView; off by default so short screens stay static. */
  scroll?: boolean;
  /** Extra classes for the content container, not the safe-area frame. */
  contentClassName?: string;
  testID?: string;
};
