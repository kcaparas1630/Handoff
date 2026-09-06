export type EventEditorProps = {
  eventId: string;
  /** The journal this entry belongs to; corrections are read back from that child's pages. */
  childId: string;
  onDone: () => void;
};
