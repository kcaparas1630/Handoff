// Proves a purge reached its terminal state: no rows anywhere still describe the child, and no
// object is left under its prefix. Run it after a deletion, and again after crashing and retrying
// the purge job (roadmap milestone 5 acceptance gate).
//
//   DATABASE_URL=... SUPABASE_URL=... pnpm verify:purge --workspace <uuid> --child <uuid>
//
// It prints counts and nothing else. A count is not personal data; a name, a transcript, or an
// object key would be, so none of them are read or printed.
import { createDbClient } from "../packages/db/src/client";
import * as purgeRepository from "../packages/db/src/repositories/purge";
import { withTenantTransaction } from "../packages/db/src/tenant-transaction";
import {
  childObjectPrefix,
  createSupabaseStorage,
  loadServerEnv,
  requireStorageEnv,
  ServerEnvError,
} from "../packages/server/src/index";
import type { PurgeCounts } from "../packages/db/src/types/purge";

const OBJECT_LIST_LIMIT = 1_000;

function readArgument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${name} <uuid> is required`);
  }
  return value;
}

/**
 * A purged child keeps exactly two things: the tombstone row its audit records point at, and its
 * redacted brief rows. Everything else must be zero, and every redacted brief must really be
 * redacted, which is what `unredactedBriefs` reports.
 */
function liveReferences(counts: PurgeCounts): number {
  return (
    counts.captures +
    counts.events +
    counts.eventRevisions +
    counts.mediaAssets +
    counts.careSessions +
    counts.handoffCursors +
    counts.childCaregivers +
    counts.invitationChildGrants +
    counts.jobs +
    counts.unredactedBriefs +
    counts.liveChildRows
  );
}

async function main(): Promise<void> {
  const workspaceId = readArgument("workspace");
  const childId = readArgument("child");
  const env = loadServerEnv(process.env);
  const client = createDbClient({ url: env.databaseUrl, maxConnections: 1 });

  try {
    const counts = await withTenantTransaction(client.db, { workspaceId }, (tx) =>
      purgeRepository.countRemainingForChild(tx, { workspaceId, childId }),
    );
    for (const [table, count] of Object.entries(counts)) {
      console.info(`${table}: ${String(count)}`);
    }

    const storage = createSupabaseStorage(requireStorageEnv(env));
    const objects = await storage.listObjects(
      childObjectPrefix(workspaceId, childId),
      OBJECT_LIST_LIMIT,
    );
    console.info(`objects: ${String(objects.length)}`);

    const remaining = liveReferences(counts) + objects.length;
    if (remaining > 0) {
      console.error(`purge is not complete: ${String(remaining)} live references remain`);
      process.exit(1);
    }
    console.info(
      `purge verified: 0 live references, ${String(counts.redactedBriefs)} redacted brief rows retained`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ServerEnvError) {
    console.error(`configuration is incomplete: ${error.variables.join(", ")}`);
    process.exit(78);
  }
  console.error(`verification failed: ${error instanceof Error ? error.message : "UnknownError"}`);
  process.exit(1);
});
