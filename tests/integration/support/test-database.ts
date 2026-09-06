import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import postgres from "postgres";
import { runMigrations } from "../../../packages/db/src/migrate";

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
