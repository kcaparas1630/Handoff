import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { careSessions } from "../schema";
import type { CareSessionRow, StartCareSession, StartedCareSession } from "../types/care";
import type { HandoffTransaction } from "../types/database";
import type { CareEndReason } from "../types/enums";

/**
 * Opens a session unless this user already has one open for this child. The partial unique index
 * decides, so a double tap or a racing retry both resolve to the same open session.
 */
export async function startCareSession(
  tx: HandoffTransaction,
  input: StartCareSession,
): Promise<StartedCareSession> {
  const [inserted] = await tx
    .insert(careSessions)
    .values(input)
    // Matches the partial index: a conflict only exists while the other session is still open.
    .onConflictDoNothing({
      target: [careSessions.childId, careSessions.userId],
      where: isNull(careSessions.endedAt),
    })
    .returning();
  if (inserted) return { session: inserted, created: true };

  const existing = await findOpenSessionForUser(tx, input.workspaceId, input.childId, input.userId);
  if (!existing) throw new Error("care session insert conflicted but no open session is present");
  return { session: existing, created: false };
}

/** Ends only the caller's own session. Another caregiver's session is untouched. */
export async function endCareSession(
  tx: HandoffTransaction,
  input: {
    workspaceId: string;
    childId: string;
    userId: string;
    endReason: CareEndReason;
  },
): Promise<CareSessionRow | null> {
  const [row] = await tx
    .update(careSessions)
    .set({
      endedAt: sql`now()`,
      endReason: input.endReason,
      updatedAt: sql`now()`,
      version: sql`${careSessions.version} + 1`,
    })
    .where(
      and(
        eq(careSessions.workspaceId, input.workspaceId),
        eq(careSessions.childId, input.childId),
        eq(careSessions.userId, input.userId),
        isNull(careSessions.endedAt),
      ),
    )
    .returning();
  return row ?? null;
}

export async function listActiveSessionsForChild(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
): Promise<CareSessionRow[]> {
  return tx
    .select()
    .from(careSessions)
    .where(
      and(
        eq(careSessions.workspaceId, workspaceId),
        eq(careSessions.childId, childId),
        isNull(careSessions.endedAt),
      ),
    )
    .orderBy(asc(careSessions.startedAt), asc(careSessions.id));
}

export async function findOpenSessionForUser(
  tx: HandoffTransaction,
  workspaceId: string,
  childId: string,
  userId: string,
): Promise<CareSessionRow | null> {
  const [row] = await tx
    .select()
    .from(careSessions)
    .where(
      and(
        eq(careSessions.workspaceId, workspaceId),
        eq(careSessions.childId, childId),
        eq(careSessions.userId, userId),
        isNull(careSessions.endedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Revocation closes that member's sessions across every child, and nobody else's. */
export async function endAllSessionsForUserInWorkspace(
  tx: HandoffTransaction,
  input: { workspaceId: string; userId: string; endReason: CareEndReason },
): Promise<CareSessionRow[]> {
  return tx
    .update(careSessions)
    .set({
      endedAt: sql`now()`,
      endReason: input.endReason,
      updatedAt: sql`now()`,
      version: sql`${careSessions.version} + 1`,
    })
    .where(
      and(
        eq(careSessions.workspaceId, input.workspaceId),
        eq(careSessions.userId, input.userId),
        isNull(careSessions.endedAt),
      ),
    )
    .returning();
}

/** Child deletion closes every open session for that child, whoever declared it. */
export async function endAllSessionsForChild(
  tx: HandoffTransaction,
  input: { workspaceId: string; childId: string; endReason: CareEndReason },
): Promise<CareSessionRow[]> {
  return tx
    .update(careSessions)
    .set({
      endedAt: sql`now()`,
      endReason: input.endReason,
      updatedAt: sql`now()`,
      version: sql`${careSessions.version} + 1`,
    })
    .where(
      and(
        eq(careSessions.workspaceId, input.workspaceId),
        eq(careSessions.childId, input.childId),
        isNull(careSessions.endedAt),
      ),
    )
    .returning();
}

/** Workspace deletion closes every open session in the workspace in one statement. */
export async function endAllSessionsInWorkspace(
  tx: HandoffTransaction,
  input: { workspaceId: string; endReason: CareEndReason },
): Promise<CareSessionRow[]> {
  return tx
    .update(careSessions)
    .set({
      endedAt: sql`now()`,
      endReason: input.endReason,
      updatedAt: sql`now()`,
      version: sql`${careSessions.version} + 1`,
    })
    .where(and(eq(careSessions.workspaceId, input.workspaceId), isNull(careSessions.endedAt)))
    .returning();
}
