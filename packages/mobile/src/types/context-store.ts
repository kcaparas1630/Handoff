export type SelectedContextState = {
  selectedWorkspaceId: string | null;
  selectedChildId: string | null;
  selectWorkspace: (workspaceId: string | null) => void;
  selectChild: (childId: string | null) => void;
  /** Called on sign-out so the next account starts with no selection. */
  resetSelection: () => void;
};
