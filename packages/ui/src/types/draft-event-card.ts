import type { EventCardKind } from "./event-card";

/** One readable fact chip: an amount with its unit, or the proposed date and time. */
export type DraftChip = {
  label: string;
  /** `attention` marks a value the caregiver still has to confirm, alongside the prompt line. */
  tone?: "neutral" | "attention";
};

export type DraftEventCardProps = {
  kind: EventCardKind;
  /** The rendered candidate. The card never derives wording from raw fields. */
  factText: string;
  chips: readonly DraftChip[];
  /** A specific question such as "Which day was 2 am?"; omitted when nothing is uncertain. */
  ambiguityPrompt?: string | undefined;
  /** Discarded candidates stay visible and struck through so nothing disappears silently. */
  isDiscarded: boolean;
  onEdit: () => void;
  onToggleDiscard: () => void;
  className?: string | undefined;
  testID?: string | undefined;
};
