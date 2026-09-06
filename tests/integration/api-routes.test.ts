// Exercises the Expo API route modules exactly as the server invokes them: the exported HTTP
// method functions, real Request objects, and the params record expo-server passes as the second
// argument. It reads as the HTTP contract in docs/data-contract.md section 8.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as acceptInvitationRoute from "../../apps/api/src/app/accept-invitation+api";
import * as bootstrapRoute from "../../apps/api/src/app/v1/bootstrap+api";
import * as caregiversRoute from "../../apps/api/src/app/v1/children/[childId]/caregivers+api";
import * as childRoute from "../../apps/api/src/app/v1/children/[childId]/index+api";
import * as healthRoute from "../../apps/api/src/app/v1/health+api";
import * as webhookRoute from "../../apps/api/src/app/v1/webhooks/clerk+api";
import * as workspaceChildrenRoute from "../../apps/api/src/app/v1/workspaces/[workspaceId]/children+api";
import * as workspaceInvitationsRoute from "../../apps/api/src/app/v1/workspaces/[workspaceId]/invitations+api";
import * as workspacesRoute from "../../apps/api/src/app/v1/workspaces/index+api";
import { overrideRuntimeForTests } from "../../apps/api/src/server-runtime";
import {
  bootstrapResponseSchema,
  childDtoSchema,
  cursorPage,
  invitationDtoSchema,
  workspaceDtoSchema,
} from "../../packages/contracts/src/index";
import { createDbClient } from "../../packages/db/src/client";
import { createDataKeyStore } from "../../packages/db/src/repositories/data-keys";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { ApiHttpError } from "../../packages/server/src/http/errors";
import { createRequestDeps } from "../../packages/server/src/runtime";
import { createChild } from "../../packages/server/src/services/children";
import { createDataKeyService } from "../../packages/server/src/security/encryption/data-keys";
import { createDevelopmentKeyWrapper } from "../../packages/server/src/security/encryption/development-key-wrapper";
import type { DbClient } from "../../packages/db/src/client";
import type { ServerRuntime } from "../../packages/server/src/types/runtime";
import type { FakeClerkGateway } from "./support/fake-clerk-gateway";
import { createFakeClerkGateway } from "./support/fake-clerk-gateway";
import type { TestDatabase } from "./support/test-database";
import { createTestDatabase, missingDatabaseUrlMessage } from "./support/test-database";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping API route tests. ${missingDatabaseUrlMessage}`);

const ORIGIN = "https://api.handoff.test";
const OWNER_TOKEN = "user_route_owner";
const OUTSIDER_TOKEN = "user_route_outsider";
const OWNER_ORG_ID = "org_route_household";
const OUTSIDER_ORG_ID = "org_route_outsider";

/** The fake gateway treats the bearer token as the verified Clerk subject. */
function authorized(token: string, idempotencyKey?: string): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (idempotencyKey !== undefined) headers["idempotency-key"] = idempotencyKey;
  return headers;
}

function jsonRequest(
  method: string,
  path: string,
  { headers, body }: { headers?: Record<string, string>; body?: string } = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body }),
  });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function readBody(response: Response): Promise<Record<string, unknown>> {
  // Every response carries personal data once decrypted, so nothing here may be cached.
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const requestId = response.headers.get("X-Request-Id");
  expect(requestId).toMatch(uuidPattern);
  const body = (await response.json()) as Record<string, unknown>;
  // Error envelopes repeat the header value, so a client can quote either one.
  if (!response.ok) expect(body.requestId).toBe(requestId);
  return body;
}

describeIntegration("v1 API routes", () => {
  let database: TestDatabase;
  let api: DbClient;
  let clerk: FakeClerkGateway;
  let runtime: ServerRuntime;

  let ownerUserId: string;
  let workspaceId: string;
  let childId: string;

  /** Superuser connection: these counts must see rows regardless of tenant context. */
  async function withAdminSession<T>(run: (session: postgres.Sql) => Promise<T>): Promise<T> {
    const session = postgres(database.adminUrl, { max: 1, prepare: false, onnotice: () => {} });
    try {
      return await run(session);
    } finally {
      await session.end();
    }
  }

  async function countChildren(): Promise<number> {
    return withAdminSession(async (session) => {
      const rows = await session<{ count: number }[]>`
        select count(*)::int as count from handoff.children
      `;
      return rows[0]?.count ?? 0;
    });
  }

  async function countIdempotencyRecords(key: string): Promise<number> {
    return withAdminSession(async (session) => {
      const rows = await session<{ count: number }[]>`
        select count(*)::int as count from handoff.idempotency_requests where key = ${key}
      `;
      return rows[0]?.count ?? 0;
    });
  }

  async function signIn(token: string, email: string, displayName: string): Promise<string> {
    clerk.setUser(token, email);
    const response = await bootstrapRoute.POST(
      jsonRequest("POST", "/v1/bootstrap", {
        headers: authorized(token, randomUUID()),
        body: JSON.stringify({ displayName }),
      }),
    );
    const body = bootstrapResponseSchema.parse(await readBody(response));
    return body.user.id;
  }

  async function initializeWorkspaceFor(
    token: string,
    clerkOrgId: string,
    name: string,
  ): Promise<string> {
    clerk.setMembership({
      clerkOrgId,
      clerkUserId: token,
      clerkMembershipId: `orgmem_${clerkOrgId}`,
      role: "org:admin",
    });
    const response = await workspacesRoute.POST(
      jsonRequest("POST", "/v1/workspaces", {
        headers: authorized(token, randomUUID()),
        body: JSON.stringify({
          clerkOrgId,
          kind: "household",
          name,
          timezone: "America/Vancouver",
        }),
      }),
    );
    expect(response.status).toBe(201);
    return workspaceDtoSchema.parse(await readBody(response)).id;
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    api = createDbClient({ url: database.apiUrl, maxConnections: 10 });
    clerk = createFakeClerkGateway();
    const keyWrapper = createDevelopmentKeyWrapper(randomBytes(32).toString("base64"));
    runtime = {
      db: api.db,
      keys: createDataKeyService({ store: createDataKeyStore(api.db), wrapper: keyWrapper }),
      keyWrapper,
      clerk,
      guardianRoleKey: "org:guardian",
      invitationRedirectUrl: `${ORIGIN}/accept-invitation`,
      now: () => new Date(),
      close: () => api.close(),
    };
    overrideRuntimeForTests(runtime);

    ownerUserId = await signIn(OWNER_TOKEN, "route-owner@example.test", "Route Owner");
    workspaceId = await initializeWorkspaceFor(OWNER_TOKEN, OWNER_ORG_ID, "Route Household");

    const created = await workspaceChildrenRoute.POST(
      jsonRequest("POST", `/v1/workspaces/${workspaceId}/children`, {
        headers: authorized(OWNER_TOKEN, randomUUID()),
        body: JSON.stringify({ name: "Rowan", birthdate: "2022-04-01" }),
      }),
      { workspaceId },
    );
    expect(created.status).toBe(201);
    childId = childDtoSchema.parse(await readBody(created)).id;
  }, 60_000);

  afterAll(async () => {
    await api?.close();
    await database?.drop();
  });

  it("answers health without any configuration", async () => {
    const response = healthRoute.GET();
    expect(response.status).toBe(200);
    expect(await readBody(response)).toMatchObject({ status: "ok" });
  });

  it("rejects bootstrap without a bearer token", async () => {
    const response = await bootstrapRoute.POST(jsonRequest("POST", "/v1/bootstrap"));
    expect(response.status).toBe(401);
    const body = await readBody(response);
    expect(body.code).toBe("unauthorized");
    expect(body.requestId).toBe(response.headers.get("X-Request-Id"));
  });

  it("bootstraps a verified subject and returns the contract DTO", async () => {
    const response = await bootstrapRoute.POST(
      jsonRequest("POST", "/v1/bootstrap", { headers: authorized(OWNER_TOKEN, randomUUID()) }),
    );
    expect(response.status).toBe(200);
    const body = bootstrapResponseSchema.parse(await readBody(response));
    expect(body.user.id).toBe(ownerUserId);
    expect(body.workspaces.map((workspace) => workspace.id)).toContain(workspaceId);
  });

  it("returns the same workspace when initialization is retried", async () => {
    const again = await initializeWorkspaceFor(OWNER_TOKEN, OWNER_ORG_ID, "Route Household");
    expect(again).toBe(workspaceId);
  });

  it("lists the workspace's children as a cursor page", async () => {
    const response = await workspaceChildrenRoute.GET(
      jsonRequest("GET", `/v1/workspaces/${workspaceId}/children`, {
        headers: authorized(OWNER_TOKEN),
      }),
      { workspaceId },
    );
    expect(response.status).toBe(200);
    const page = cursorPage(childDtoSchema).parse(await readBody(response));
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((child) => child.id)).toEqual([childId]);
  });

  it("reads a child by id and its caregivers", async () => {
    const child = await childRoute.GET(
      jsonRequest("GET", `/v1/children/${childId}`, { headers: authorized(OWNER_TOKEN) }),
      { childId },
    );
    expect(child.status).toBe(200);
    expect(childDtoSchema.parse(await readBody(child)).permission).toBe("manager");

    const caregivers = await caregiversRoute.GET(
      jsonRequest("GET", `/v1/children/${childId}/caregivers`, {
        headers: authorized(OWNER_TOKEN),
      }),
      { childId },
    );
    expect(caregivers.status).toBe(200);
    expect(await readBody(caregivers)).toMatchObject({ nextCursor: null });
  });

  it("hides another user's child behind the same 404 as an unknown id", async () => {
    await signIn(OUTSIDER_TOKEN, "route-outsider@example.test", "Route Outsider");
    await initializeWorkspaceFor(OUTSIDER_TOKEN, OUTSIDER_ORG_ID, "Outsider Household");

    const response = await childRoute.GET(
      jsonRequest("GET", `/v1/children/${childId}`, { headers: authorized(OUTSIDER_TOKEN) }),
      { childId },
    );
    expect(response.status).toBe(404);
    expect((await readBody(response)).code).toBe("not_found");
  });

  it("rejects an edit that carries a stale expected version", async () => {
    const response = await childRoute.PATCH(
      jsonRequest("PATCH", `/v1/children/${childId}`, {
        headers: authorized(OWNER_TOKEN, randomUUID()),
        body: JSON.stringify({ expectedVersion: 99, name: "Rowan Two" }),
      }),
      { childId },
    );
    expect(response.status).toBe(409);
    expect((await readBody(response)).code).toBe("conflict");
  });

  it("replays a child create for a repeated key and rejects a reused key", async () => {
    const key = randomUUID();
    const body = JSON.stringify({ name: "Wren" });
    const path = `/v1/workspaces/${workspaceId}/children`;
    const before = await countChildren();

    const first = await workspaceChildrenRoute.POST(
      jsonRequest("POST", path, { headers: authorized(OWNER_TOKEN, key), body }),
      { workspaceId },
    );
    expect(first.status).toBe(201);
    const created = childDtoSchema.parse(await readBody(first));

    const replay = await workspaceChildrenRoute.POST(
      jsonRequest("POST", path, { headers: authorized(OWNER_TOKEN, key), body }),
      { workspaceId },
    );
    expect(replay.status).toBe(201);
    // The retained response is returned verbatim; the write is not repeated.
    expect(childDtoSchema.parse(await readBody(replay))).toEqual(created);
    expect(await countChildren()).toBe(before + 1);

    const reused = await workspaceChildrenRoute.POST(
      jsonRequest("POST", path, {
        headers: authorized(OWNER_TOKEN, key),
        body: JSON.stringify({ name: "Someone Else" }),
      }),
      { workspaceId },
    );
    expect(reused.status).toBe(409);
    expect((await readBody(reused)).code).toBe("idempotency_key_reused");
    expect(await countChildren()).toBe(before + 1);
  });

  it("rolls the replay record back with the write when the service rejects the request", async () => {
    const key = randomUUID();
    const before = await countChildren();

    const response = await workspaceChildrenRoute.POST(
      jsonRequest("POST", `/v1/workspaces/${workspaceId}/children`, {
        headers: authorized(OWNER_TOKEN, key),
        // A real calendar date, so the contracts schema accepts it and only the service rejects it.
        body: JSON.stringify({ name: "Future", birthdate: "2999-01-01" }),
      }),
      { workspaceId },
    );
    expect(response.status).toBe(422);

    // The write and the record share one transaction, so neither survives (data contract §5).
    expect(await countChildren()).toBe(before);
    expect(await countIdempotencyRecords(key)).toBe(0);
  });

  it("writes a child inside the caller's transaction, not its own", async () => {
    const before = await countChildren();
    const deps = createRequestDeps(runtime, randomUUID());

    // Rolling the caller's transaction back must discard the insert. That is what makes the
    // idempotency record runIdempotent writes in the same transaction share its fate.
    await expect(
      withTenantTransaction(runtime.db, { workspaceId }, async (transaction) => {
        await createChild({
          deps,
          actorUserId: ownerUserId,
          workspaceId,
          input: { name: "Rolled Back" },
          tx: { transaction, workspaceId },
        });
        throw new Error("roll back");
      }),
    ).rejects.toThrow("roll back");
    expect(await countChildren()).toBe(before);
  });

  it("fails closed when handed a transaction scoped to another workspace", async () => {
    const deps = createRequestDeps(runtime, randomUUID());
    const failure = await withTenantTransaction(
      runtime.db,
      { workspaceId },
      async (transaction) => {
        try {
          await createChild({
            deps,
            actorUserId: ownerUserId,
            workspaceId,
            input: { name: "Wrong Tenant" },
            tx: { transaction, workspaceId: randomUUID() },
          });
          return null;
        } catch (error) {
          return error;
        }
      },
    );
    expect(failure).toBeInstanceOf(ApiHttpError);
    expect((failure as ApiHttpError).status).toBe(500);
  });

  it("returns the same invitation intent for a repeated address", async () => {
    const invitation = JSON.stringify({
      email: "route-invitee@example.test",
      intendedAppRole: "caregiver",
      childGrants: [{ childId, relationship: "caregiver", permission: "contributor" }],
    });
    const path = `/v1/workspaces/${workspaceId}/invitations`;

    const first = await workspaceInvitationsRoute.POST(
      jsonRequest("POST", path, {
        headers: authorized(OWNER_TOKEN, randomUUID()),
        body: invitation,
      }),
      { workspaceId },
    );
    expect(first.status).toBe(201);
    const created = invitationDtoSchema.parse(await readBody(first));

    // Idempotent by construction rather than by replay record: the same address finds the open
    // intent, so no idempotency row is retained for a route that also calls Clerk.
    const again = await workspaceInvitationsRoute.POST(
      jsonRequest("POST", path, {
        headers: authorized(OWNER_TOKEN, randomUUID()),
        body: invitation,
      }),
      { workspaceId },
    );
    expect(again.status).toBe(201);
    expect(invitationDtoSchema.parse(await readBody(again)).id).toBe(created.id);

    const list = await workspaceInvitationsRoute.GET(
      jsonRequest("GET", path, { headers: authorized(OWNER_TOKEN) }),
      { workspaceId },
    );
    const page = cursorPage(invitationDtoSchema).parse(await readBody(list));
    expect(page.items.map((intent) => intent.id)).toEqual([created.id]);
  });

  it("rejects a body that is not valid JSON", async () => {
    const response = await workspaceChildrenRoute.POST(
      jsonRequest("POST", `/v1/workspaces/${workspaceId}/children`, {
        headers: authorized(OWNER_TOKEN, randomUUID()),
        body: '{"name": ',
      }),
      { workspaceId },
    );
    expect(response.status).toBe(422);
    expect((await readBody(response)).code).toBe("validation_failed");
  });

  it("requires an Idempotency-Key on a state-changing request", async () => {
    const response = await workspaceChildrenRoute.POST(
      jsonRequest("POST", `/v1/workspaces/${workspaceId}/children`, {
        headers: authorized(OWNER_TOKEN),
        body: JSON.stringify({ name: "Unkeyed" }),
      }),
      { workspaceId },
    );
    expect(response.status).toBe(422);
    const body = await readBody(response);
    expect(body.code).toBe("validation_failed");
    expect(body.fieldErrors).toMatchObject({
      "Idempotency-Key": ["Expected a client-generated UUID"],
    });
  });

  it("refuses a webhook whose signature does not verify", async () => {
    // Mirrors the real gateway, which converts any Svix verification failure into a 401.
    overrideRuntimeForTests({
      ...runtime,
      clerk: {
        ...clerk,
        verifyWebhook: () =>
          Promise.reject(ApiHttpError.unauthorized("The webhook signature is not valid")),
      },
    });
    try {
      const response = await webhookRoute.POST(
        jsonRequest("POST", "/v1/webhooks/clerk", {
          headers: { "svix-id": "msg_route_one" },
          body: JSON.stringify({ type: "organizationMembership.created" }),
        }),
      );
      expect(response.status).toBe(401);
      expect((await readBody(response)).code).toBe("unauthorized");
    } finally {
      overrideRuntimeForTests(runtime);
    }
  });

  it("reserves child deletion until the purge job exists", async () => {
    const response = await childRoute.DELETE(
      jsonRequest("DELETE", `/v1/children/${childId}`, { headers: authorized(OWNER_TOKEN) }),
    );
    expect(response.status).toBe(501);
    const body = await readBody(response);
    expect(body.code).toBe("internal");
    expect(body.message).toBe("Child deletion arrives with the purge job in milestone 5");
  });

  it("renders the invitation landing page without echoing the Clerk ticket", async () => {
    const configured = {
      CLERK_SECRET_KEY: "sk_test_placeholder",
      CLERK_WEBHOOK_SIGNING_SECRET: "whsec_placeholder",
      CLERK_GUARDIAN_ROLE_KEY: "org:guardian",
      PII_KEY_PROVIDER: "development",
      PII_DEV_WRAPPING_KEY_B64: randomBytes(32).toString("base64"),
      INVITATION_REDIRECT_URL: `${ORIGIN}/accept-invitation`,
      APP_LINK_PARENTS: "https://handoff.test/app/parents",
      APP_LINK_DAYCARE: "https://handoff.test/app/daycare",
    };
    Object.assign(process.env, configured);
    try {
      const response = await acceptInvitationRoute.GET(
        new Request(`${ORIGIN}/accept-invitation?__clerk_ticket=tkt_secret&__clerk_status=sign_up`),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      const html = await response.text();
      expect(html).not.toContain("tkt_secret");
      expect(html).not.toContain("__clerk");
      expect(html).not.toContain("<script");
      expect(html).toContain("https://handoff.test/app/parents");
      expect(html).toContain("https://handoff.test/app/daycare");
    } finally {
      for (const name of Object.keys(configured)) delete process.env[name];
    }
  });
});
