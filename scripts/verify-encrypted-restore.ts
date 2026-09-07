// Proves a restored backup is readable with the keys you still hold. Point DATABASE_URL at the
// restored copy and configure the wrapping key that copy's records were written under, then:
//
//   DATABASE_URL=... PII_KEY_PROVIDER=... pnpm verify:restore --workspace <uuid>
//
// It decrypts one record per covered table and prints OK or FAIL for each. Plaintext is never
// printed, written, or returned: the check is that authenticated decryption succeeded, which is
// exactly what a restore has to establish (docs/pii-encryption.md, "Required verification" 7).
import { KMSClient } from "@aws-sdk/client-kms";
import { createDataKeyStore, createDbClient, dataKeyRepository } from "../packages/db/src/index";
import * as envelopeRepository from "../packages/db/src/repositories/envelopes";
import { withTenantTransaction } from "../packages/db/src/tenant-transaction";
import {
  createDataKeyService,
  createDevelopmentKeyWrapper,
  createKmsKeyWrapper,
  loadServerEnv,
  ROTATABLE_TABLES,
  ServerEnvError,
} from "../packages/server/src/index";
import { decryptField } from "../packages/server/src/security/encryption/field-encryption";
import { ciphertextEnvelopeSchema } from "../packages/server/src/schemas/ciphertext-envelope";
import type { RotatableTable } from "../packages/db/src/types/envelopes";
import type { KeyWrapper, ServerEnv } from "../packages/server/src/index";

/** Mirrors the record context each column's ciphertext is bound to; a mismatch fails the tag. */
function recordFor(table: RotatableTable, rowId: string[]) {
  const [id] = rowId;
  if (id === undefined) throw new Error("an envelope row id is empty");
  switch (table) {
    case "children":
      return { table: "children", rowId: id, column: "profile_ciphertext" };
    case "invitation_intents":
      return { table: "invitation_intents", rowId: id, column: "invitee_ciphertext" };
    case "captures":
      return { table: "captures", rowId: id, column: "content_ciphertext" };
    case "events":
      return { table: "events", rowId: id, column: "payload_ciphertext" };
    case "event_revisions":
      return { table: "event_revisions", rowId: id, column: "content_ciphertext" };
    case "handoff_briefs":
      return { table: "handoff_briefs", rowId: id, column: "snapshot_ciphertext" };
    case "idempotency_requests":
      return { table: "idempotency_requests", rowId, column: "response_ciphertext" };
  }
}

function readArgument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${name} <uuid> is required`);
  }
  return value;
}

function createKeyWrapper(env: ServerEnv): KeyWrapper {
  if (env.piiKeyProvider === "development") {
    if (env.piiDevWrappingKeyB64 === null) {
      throw new Error("PII_DEV_WRAPPING_KEY_B64 is required for the development key provider");
    }
    return createDevelopmentKeyWrapper(env.piiDevWrappingKeyB64);
  }
  if (env.piiKmsKeyId === null || env.awsRegion === null) {
    throw new Error("PII_KMS_KEY_ID and AWS_REGION are required for the kms key provider");
  }
  return createKmsKeyWrapper({
    client: new KMSClient({ region: env.awsRegion }),
    keyId: env.piiKmsKeyId,
  });
}

async function main(): Promise<void> {
  const workspaceId = readArgument("workspace");
  const env = loadServerEnv(process.env);
  const client = createDbClient({ url: env.databaseUrl, maxConnections: 2 });
  const keys = createDataKeyService({
    store: createDataKeyStore(client.db),
    wrapper: createKeyWrapper(env),
  });

  let failures = 0;
  try {
    for (const table of ROTATABLE_TABLES) {
      const result = await verifyTable({ table, workspaceId, client, keys });
      console.info(`${table}: ${result}`);
      if (result === "FAIL") failures += 1;
    }
  } finally {
    await client.close();
  }

  if (failures > 0) {
    console.error(`${String(failures)} table(s) could not be decrypted from this restore`);
    process.exit(1);
  }
  console.info("restore verified: every covered table decrypted with the configured wrapping key");
}

type VerifyResult = "OK" | "FAIL" | "EMPTY";

/**
 * Reads one row and decrypts it. The plaintext is discarded immediately; only the outcome is
 * reported, so running this against real data reveals nothing a database dump did not already.
 */
async function verifyTable({
  table,
  workspaceId,
  client,
  keys,
}: {
  table: RotatableTable;
  workspaceId: string;
  client: ReturnType<typeof createDbClient>;
  keys: ReturnType<typeof createDataKeyService>;
}): Promise<VerifyResult> {
  const rows = await withTenantTransaction(client.db, { workspaceId }, async (tx) => {
    // The batch reader is keyed by data key, so every key this workspace ever used is tried.
    const found = [];
    for (const key of await listWorkspaceKeyIds(tx, workspaceId)) {
      found.push(
        ...(await envelopeRepository.listEnvelopeBatch(tx, {
          table,
          workspaceId,
          keyId: key,
          limit: 1,
        })),
      );
      if (found.length > 0) break;
    }
    return found;
  });

  const row = rows[0];
  if (row === undefined) return "EMPTY";
  try {
    ciphertextEnvelopeSchema.parse(row.envelope);
    await decryptField({
      keys,
      scope: { kind: "workspace", workspaceId },
      record: recordFor(table, row.rowId),
      envelope: row.envelope,
    });
    return "OK";
  } catch {
    return "FAIL";
  }
}

/** Every content key the workspace has ever held, so a restore predating a rotation still reads. */
async function listWorkspaceKeyIds(
  tx: Parameters<typeof envelopeRepository.listEnvelopeBatch>[0],
  workspaceId: string,
): Promise<string[]> {
  const keys = await dataKeyRepository.listDataKeysForScope(
    tx,
    { kind: "workspace", workspaceId },
    "content",
  );
  return keys.map((key) => key.id);
}

main().catch((error: unknown) => {
  if (error instanceof ServerEnvError) {
    console.error(`configuration is incomplete: ${error.variables.join(", ")}`);
    process.exit(78);
  }
  console.error(`verification failed: ${error instanceof Error ? error.message : "UnknownError"}`);
  process.exit(1);
});
