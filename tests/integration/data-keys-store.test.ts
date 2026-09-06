import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/client";
import * as identityRepository from "../../packages/db/src/repositories/identity";
import { createDataKeyStore } from "../../packages/db/src/repositories/data-keys";
import {
  withIdentityTransaction,
  withTenantTransaction,
} from "../../packages/db/src/tenant-transaction";
import type { DbClient } from "../../packages/db/src/client";
import type { NewDataKey } from "../../packages/db/src/types/data-keys";
import type { TestDatabase } from "./support/test-database";
import {
  createTestDatabase,
  missingDatabaseUrlMessage,
  syntheticEnvelope,
} from "./support/test-database";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping data key store tests. ${missingDatabaseUrlMessage}`);

describeIntegration("data key store", () => {
  let database: TestDatabase;
  let client: DbClient;
  let workspaceId: string;
  let userId: string;

  function candidate(scopeWorkspaceId: string): NewDataKey {
    return {
      scope: { kind: "workspace", workspaceId: scopeWorkspaceId },
      purpose: "content",
      version: 1,
      wrappedKey: new Uint8Array(randomBytes(48)),
      wrappingProvider: "development",
      wrappingKeyRef: "local/test",
      wrappingContextVersion: 1,
    };
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    client = createDbClient({ url: database.apiUrl, maxConnections: 10 });
    workspaceId = randomUUID();
    const user = await withIdentityTransaction(client.db, {}, (tx) =>
      identityRepository.upsertUserByClerkId(tx, {
        clerkUserId: "user_data_keys",
        profileCiphertext: syntheticEnvelope("user-data-keys"),
      }),
    );
    userId = user.id;
    await withTenantTransaction(client.db, { workspaceId }, (tx) =>
      identityRepository.insertWorkspace(tx, {
        id: workspaceId,
        clerkOrgId: "org_data_keys",
        kind: "household",
        profileCiphertext: syntheticEnvelope("workspace-data-keys"),
        timezone: "America/Vancouver",
        storageBudgetBytes: 1_000_000,
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    await database?.drop();
  });

  it("provisions exactly one active key when a scope is used concurrently", async () => {
    const store = createDataKeyStore(client.db);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.insertActiveKeyIfAbsent(candidate(workspaceId))),
    );

    const uniqueIds = new Set(results.map((row) => row.id));
    expect(uniqueIds.size).toBe(1);

    const active = await store.findActiveKey({ kind: "workspace", workspaceId }, "content");
    expect(active?.id).toBe([...uniqueIds][0]);
    expect(active?.scope).toEqual({ kind: "workspace", workspaceId });

    const session = postgres(database.adminUrl, { max: 1, prepare: false });
    try {
      const rows = await session`
        select count(*)::int as count from handoff.data_keys
        where workspace_id = ${workspaceId} and purpose = 'content' and state = 'active'
      `;
      expect(rows[0]?.count).toBe(1);
    } finally {
      await session.end();
    }
  });

  it("reserves usage against an active key and refuses a decrypt-only key", async () => {
    const store = createDataKeyStore(client.db);
    const key = await store.insertActiveKeyIfAbsent({
      scope: { kind: "user", userId },
      purpose: "content",
      version: 1,
      wrappedKey: new Uint8Array(randomBytes(48)),
      wrappingProvider: "development",
      wrappingKeyRef: "local/test",
      wrappingContextVersion: 1,
    });

    expect(await store.reserveEncryptions(key.id, 3)).toBe(3);
    expect(await store.reserveEncryptions(key.id, 2)).toBe(5);

    const session = postgres(database.adminUrl, { max: 1, prepare: false });
    try {
      await session`update handoff.data_keys set state = 'decrypt_only' where id = ${key.id}`;
    } finally {
      await session.end();
    }

    await expect(store.reserveEncryptions(key.id, 1)).rejects.toThrow(/not active/);
  });

  it("rejects a row with both scope ids or neither", async () => {
    const session = postgres(database.adminUrl, { max: 1, prepare: false });
    try {
      const insertScope = (scopeWorkspaceId: string | null, scopeUserId: string | null) =>
        session`
          insert into handoff.data_keys
            (workspace_id, user_id, purpose, version, wrapped_key,
             wrapping_provider, wrapping_key_ref, wrapping_context_version)
          values (${scopeWorkspaceId}, ${scopeUserId}, 'lookup', 99, ${randomBytes(48)},
                  'development', 'local/test', 1)
        `;

      await expect(insertScope(workspaceId, userId)).rejects.toThrow(
        /data_keys_single_scope_check/,
      );
      await expect(insertScope(null, null)).rejects.toThrow(/data_keys_single_scope_check/);
    } finally {
      await session.end();
    }
  });
});
