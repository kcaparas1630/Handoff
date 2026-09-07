import { and, eq, sql } from "drizzle-orm";
import { providerUsage } from "../schema";
import type { HandoffTransaction } from "../types/database";
import type { ProviderUsageRow, ProviderUsageDelta } from "../types/provider-usage";

// What one workspace has spent with the paid providers on one UTC day. Numbers only: no capture
// id, no user, no transcript length that could describe a recording. The daily extraction budget
// reads this before the model call, and the worker adds to it after.

/** Adds one job's usage. Concurrent workers serialize on the row, so no reading is lost. */
export async function addProviderUsage(
  tx: HandoffTransaction,
  input: ProviderUsageDelta,
): Promise<ProviderUsageRow> {
  const [row] = await tx
    .insert(providerUsage)
    .values({
      workspaceId: input.workspaceId,
      day: input.day,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      audioSeconds: input.audioSeconds,
    })
    .onConflictDoUpdate({
      target: [providerUsage.workspaceId, providerUsage.day],
      set: {
        tokensIn: sql`${providerUsage.tokensIn} + ${input.tokensIn}`,
        tokensOut: sql`${providerUsage.tokensOut} + ${input.tokensOut}`,
        audioSeconds: sql`${providerUsage.audioSeconds} + ${input.audioSeconds}`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  if (!row) throw new Error("addProviderUsage returned no row");
  return row;
}

/** Null when this workspace has spent nothing today, which is not the same as a zero row. */
export async function findProviderUsage(
  tx: HandoffTransaction,
  workspaceId: string,
  day: string,
): Promise<ProviderUsageRow | null> {
  const [row] = await tx
    .select()
    .from(providerUsage)
    .where(and(eq(providerUsage.workspaceId, workspaceId), eq(providerUsage.day, day)))
    .limit(1);
  return row ?? null;
}
