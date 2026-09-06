import { create } from "zustand";

import type { SelectedContextState } from "../types/context-store";

/**
 * Transient selection only. Workspaces, children, and every other server record belong to
 * TanStack Query (architecture.md section 7); nothing here survives sign-out.
 */
export const useSelectedContext = create<SelectedContextState>()((set) => ({
  selectedWorkspaceId: null,
  selectedChildId: null,

  // A child belongs to one workspace, so changing workspace drops the stale child selection.
  selectWorkspace: (workspaceId) =>
    set((state) =>
      state.selectedWorkspaceId === workspaceId
        ? state
        : { selectedWorkspaceId: workspaceId, selectedChildId: null },
    ),

  selectChild: (childId) => set({ selectedChildId: childId }),

  resetSelection: () => set({ selectedWorkspaceId: null, selectedChildId: null }),
}));
