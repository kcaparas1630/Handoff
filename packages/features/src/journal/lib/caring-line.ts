import type { CareSessionDto } from "@handoff/contracts";

/**
 * Names the caregivers who declared they are caring. Multiple caregivers can be active at once,
 * and an empty list is stated plainly rather than implied.
 */
export function describeCaring(
  sessions: readonly CareSessionDto[],
  ownUserId: string | null,
): string {
  const names = sessions
    .filter((session) => session.endedAt === null)
    .map((session) =>
      session.userId === ownUserId ? "You" : (session.displayName ?? "A caregiver"),
    );

  if (names.length === 0) return "Nobody is caring right now";
  if (names.length === 1) {
    const [only] = names;
    return only === "You" ? "You are caring" : `${only ?? "A caregiver"} is caring`;
  }
  return `${names.join(" and ")} are caring`;
}
