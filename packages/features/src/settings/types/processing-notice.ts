export type ProcessingNoticePoint = {
  id: string;
  heading: string;
  body: string;
};

export type ProcessingNoticeCardProps = {
  /** What the account accepted previously; null when it has never accepted a notice. */
  acceptedVersion: string | null;
  /** Explains why the notice is blocking the current screen, when it is. */
  reason?: string;
  onAccepted?: () => void;
};
