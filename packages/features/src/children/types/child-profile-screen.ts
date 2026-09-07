export type ChildProfileScreenProps = {
  childId: string;
  /**
   * Opens privacy settings with this child preselected, which is where deletion is confirmed.
   * The button appears only for a workspace owner; the API checks the same thing again.
   */
  onOpenSettings: (childId: string) => void;
  onBack: () => void;
};
