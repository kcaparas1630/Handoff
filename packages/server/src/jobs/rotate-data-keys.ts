// Re-encrypts one workspace's existing ciphertext under the key that rotation made active. The
// rotation itself already finished before this job was queued: new writes use the new key and
// every old row still reads, so this pass is maintenance and never blocks a caregiver.
//
// Resumability comes from the batch predicate rather than an offset: a converted row stops naming
// the old key, so a resumed attempt re-reads only what it has not done. The checkpoint records
// which table the job reached, which is what an operator reads while it runs.
import { z } from "zod";
import { ROTATABLE_TABLES, convertEnvelopeBatch } from "../services/key-rotation";
import type { JobHandler, JobOutcome } from "../types/jobs";

/** Bounded so one pass cannot hold a lease open across an enormous workspace. */
const BATCH_LIMIT = 100;

const payloadSchema = z.object({ workspaceId: z.uuid(), previousKeyId: z.uuid() });

export const rotateDataKeys: JobHandler = async (context) => {
  const payload = payloadSchema.safeParse(context.job.payload);
  if (!payload.success || context.job.workspaceId !== payload.data.workspaceId) {
    return { status: "failed", errorCode: "invalid_payload", retryable: false };
  }
  const { workspaceId, previousKeyId } = payload.data;

  for (const table of ROTATABLE_TABLES) {
    let converted = 0;
    for (;;) {
      const batch = await convertEnvelopeBatch({
        runtime: context.runtime,
        workspaceId,
        table,
        previousKeyId,
        limit: BATCH_LIMIT,
      });
      converted += batch.converted;
      // No progress means the remaining rows were rewritten by their own writers, which is the
      // outcome the optimistic predicate is there to produce. Retirement re-checks them later.
      if (batch.converted === 0) break;
    }
    await context.saveCheckpoint({ stage: "rotate", table, converted });
    context.runtime.logger.info("data_keys_rotated_table", {
      workspaceId,
      stage: table,
      count: converted,
    });
  }
  return { status: "completed" } satisfies JobOutcome;
};
