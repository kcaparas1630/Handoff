import { useBootstrap, useOverview } from "@handoff/api-client";

export type CaptureContext = {
  isPending: boolean;
  error: unknown;
  childName: string | null;
  workspaceId: string | null;
  /** Workspace time zone; recording is blocked until it is known, so no reading is guessed. */
  timezone: string | null;
  /** Straight from the caller's DTO permission. UI visibility is not authorization. */
  canContribute: boolean;
  /** The caller's own open care session, recorded with the capture when there is one. */
  careSessionId: string | undefined;
  refetch: () => void;
};

/**
 * The identity and time-zone context a capture needs. Both the recorder and the typed sheet keep
 * the selected child visible, so an update cannot be attached to the wrong one.
 */
export function useCaptureContext(childId: string): CaptureContext {
  const overview = useOverview(childId);
  const bootstrap = useBootstrap();

  const child = overview.data?.child ?? null;
  const workspace =
    bootstrap.data?.workspaces.find((candidate) => candidate.id === child?.workspaceId) ?? null;
  const ownUserId = bootstrap.data?.user.id ?? null;
  const ownSession = overview.data?.activeSessions.find(
    (session) => session.userId === ownUserId && session.endedAt === null,
  );

  return {
    isPending: overview.isPending,
    error: overview.error,
    childName: child?.name ?? null,
    workspaceId: child?.workspaceId ?? null,
    timezone: workspace?.timezone ?? null,
    canContribute: child !== null && child.permission !== "reader",
    careSessionId: ownSession?.id,
    refetch: () => void overview.refetch(),
  };
}
