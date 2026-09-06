import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import postgres from "postgres";
import { runMigrations } from "../../../packages/db/src/migrate";
import * as childrenRepository from "../../../packages/db/src/repositories/children";
import * as identityRepository from "../../../packages/db/src/repositories/identity";
import {
  withIdentityTransaction,
  withTenantTransaction,
} from "../../../packages/db/src/tenant-transaction";
import type { HandoffDatabase } from "../../../packages/db/src/types/database";

// Restricted login role used by the pooled tests. It inherits handoff_api, so row-level security
// applies to it; connecting as the superuser would bypass every policy and prove nothing.
// These credentials only ever address the disposable local instance in docker-compose.yml.
const apiRoleName = "handoff_api_test";
const apiRolePassword = "handoff_api_test";

export const missingDatabaseUrlMessage =
  "DATABASE_URL is not set. Point it at a disposable Postgres instance with permission to " +
  "create and drop databases, for example the docker-compose service: " +
  "postgres://postgres:handoff@localhost:55432/handoff_dev";

export interface TestDatabase {
  name: string;
  /** Migration/superuser role connected to this database. Bypasses row-level security. */
  adminUrl: string;
  /** Restricted runtime role. Subject to grants and tenant policies. */
  apiUrl: string;
  drop: () => Promise<void>;
}

function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function withCredentials(url: string, username: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = username;
  parsed.password = password;
  return parsed.toString();
}

/**
 * Creates an isolated database, migrates it, and returns connection strings for both roles.
 * Database and role names are generated or constant: DDL cannot take bind parameters.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const rootUrl = process.env.DATABASE_URL;
  if (!rootUrl) throw new Error(missingDatabaseUrlMessage);

  const name = `handoff_test_${randomUUID().replaceAll("-", "")}`;
  const root = postgres(rootUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await root.unsafe(`create database "${name}"`);
  } finally {
    await root.end();
  }

  const adminUrl = withDatabaseName(rootUrl, name);
  await runMigrations(adminUrl);

  const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    // Roles are cluster-wide, so the login role is created once and reused across test runs.
    await admin.unsafe(`do $$
      begin
        if not exists (select 1 from pg_roles where rolname = '${apiRoleName}') then
          create role ${apiRoleName} login password '${apiRolePassword}';
        end if;
      end $$`);
    await admin.unsafe(`grant handoff_api to ${apiRoleName}`);
    // Lets a non-superuser test user reach the restricted role through SET ROLE.
    await admin.unsafe(`grant handoff_api to current_user`);
  } finally {
    await admin.end();
  }

  return {
    name,
    adminUrl,
    apiUrl: withCredentials(adminUrl, apiRoleName, apiRolePassword),
    drop: async () => {
      const dropper = postgres(rootUrl, { max: 1, prepare: false, onnotice: () => {} });
      try {
        await dropper.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

export type SyntheticEnvelope = {
  formatVersion: number;
  algorithm: string;
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
};

/** Stand-in for a validated ciphertext envelope; these tests never exercise real crypto. */
export function syntheticEnvelope(label: string): SyntheticEnvelope {
  return {
    formatVersion: 1,
    algorithm: "A256GCM",
    keyId: "00000000-0000-4000-8000-000000000000",
    nonce: "AAAAAAAAAAAAAAAA",
    ciphertext: Buffer.from(label).toString("base64"),
    tag: "AAAAAAAAAAAAAAAAAAAAAA==",
  };
}

export interface SeededTenant {
  workspaceId: string;
  childId: string;
  userId: string;
}

/**
 * One workspace with an owner and a child, the smallest fixture a journal or care test needs.
 * Labels only have to be unique inside a test file; they become the synthetic Clerk ids.
 */
export async function seedTenant(db: HandoffDatabase, label: string): Promise<SeededTenant> {
  const workspaceId = randomUUID();
  const userId = await seedUser(db, label);
  await withTenantTransaction(db, { workspaceId }, async (tx) => {
    await identityRepository.insertWorkspace(tx, {
      id: workspaceId,
      clerkOrgId: `org_${label}`,
      kind: "daycare",
      profileCiphertext: syntheticEnvelope(`workspace-${label}`),
      timezone: "America/Vancouver",
      storageBudgetBytes: 1_000_000,
    });
    await identityRepository.upsertMembership(tx, {
      workspaceId,
      userId,
      clerkMembershipId: `orgmem_${label}`,
      appRole: "owner",
      status: "active",
      providerVerifiedAt: new Date(),
    });
  });
  return { workspaceId, childId: await seedChild(db, workspaceId, userId, label), userId };
}

export async function seedUser(db: HandoffDatabase, label: string): Promise<string> {
  const user = await withIdentityTransaction(db, {}, (tx) =>
    identityRepository.upsertUserByClerkId(tx, {
      clerkUserId: `user_${label}`,
      profileCiphertext: syntheticEnvelope(`user-${label}`),
    }),
  );
  return user.id;
}

/** Adds a second caregiver to an existing workspace so concurrency tests have two actors. */
export async function seedMember(
  db: HandoffDatabase,
  workspaceId: string,
  label: string,
): Promise<string> {
  const userId = await seedUser(db, label);
  await withTenantTransaction(db, { workspaceId }, (tx) =>
    identityRepository.upsertMembership(tx, {
      workspaceId,
      userId,
      clerkMembershipId: `orgmem_${label}`,
      appRole: "caregiver",
      status: "active",
      providerVerifiedAt: new Date(),
    }),
  );
  return userId;
}

export async function seedChild(
  db: HandoffDatabase,
  workspaceId: string,
  createdByUserId: string,
  label: string,
): Promise<string> {
  const childId = randomUUID();
  await withTenantTransaction(db, { workspaceId }, (tx) =>
    childrenRepository.insertChild(tx, {
      id: childId,
      workspaceId,
      profileCiphertext: syntheticEnvelope(`child-${label}`),
      createdByUserId,
    }),
  );
  return childId;
}

/** Drizzle wraps driver errors, so constraint assertions have to read the whole cause chain. */
export async function failureMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    return messages.join(" | ");
  }
  throw new Error("expected the operation to fail");
}
