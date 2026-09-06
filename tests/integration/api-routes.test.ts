// Exercises the Expo API route modules exactly as the server invokes them: the exported HTTP
// method functions, real Request objects, and the params record expo-server passes as the second
// argument. It reads as the HTTP contract in docs/data-contract.md section 8.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as acceptInvitationRoute from "../../apps/api/src/app/accept-invitation+api";
import * as bootstrapRoute from "../../apps/api/src/app/v1/bootstrap+api";
import * as confirmCaptureRoute from "../../apps/api/src/app/v1/captures/[captureId]/confirm+api";
import * as captureRoute from "../../apps/api/src/app/v1/captures/[captureId]/index+api";
import * as capturesRoute from "../../apps/api/src/app/v1/captures/index+api";
import * as careRoute from "../../apps/api/src/app/v1/children/[childId]/care+api";
import * as caregiversRoute from "../../apps/api/src/app/v1/children/[childId]/caregivers+api";
import * as childEventsRoute from "../../apps/api/src/app/v1/children/[childId]/events+api";
import * as childHandoffsRoute from "../../apps/api/src/app/v1/children/[childId]/handoffs+api";
import * as childRoute from "../../apps/api/src/app/v1/children/[childId]/index+api";
import * as overviewRoute from "../../apps/api/src/app/v1/children/[childId]/overview+api";
import * as eventRoute from "../../apps/api/src/app/v1/events/[eventId]+api";
import * as acknowledgeRoute from "../../apps/api/src/app/v1/handoffs/[briefId]/acknowledge+api";
import * as briefRoute from "../../apps/api/src/app/v1/handoffs/[briefId]/index+api";
import * as healthRoute from "../../apps/api/src/app/v1/health+api";
import * as webhookRoute from "../../apps/api/src/app/v1/webhooks/clerk+api";
import * as workspaceChildrenRoute from "../../apps/api/src/app/v1/workspaces/[workspaceId]/children+api";
import * as workspaceInvitationsRoute from "../../apps/api/src/app/v1/workspaces/[workspaceId]/invitations+api";
import * as workspacesRoute from "../../apps/api/src/app/v1/workspaces/index+api";
import { overrideRuntimeForTests } from "../../apps/api/src/server-runtime";
import {
  acknowledgeBriefResponseSchema,
  bootstrapResponseSchema,
  captureDtoSchema,
  careListResponseSchema,
  careSessionDtoSchema,
  childDtoSchema,
  confirmCaptureResponseSchema,
  cursorPage,
  eventDtoSchema,
  eventsPageSchema,
  handoffBriefDtoSchema,
  invitationDtoSchema,
  overviewDtoSchema,
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
import type { OverviewDto } from "../../packages/contracts/src/index";
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
const RECIPIENT_TOKEN = "user_route_recipient";
const READER_TOKEN = "user_route_reader";
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
  let recipientUserId: string;
  let readerUserId: string;
  let workspaceId: string;
  let childId: string;

  // The milestone 2 story runs top to bottom, so each step names what the one before it produced.
  let captureId: string;
  let feedEventId: string;
  let briefId: string;
  const feedCandidateId = randomUUID();
  const feedOccurredAt = new Date().toISOString();
  const confirmKey = randomUUID();
  let capturedDraftVersion = 0;

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

  /** Joins the owner's organization as an ordinary member before the local user is created. */
  async function joinOwnerWorkspace(
    token: string,
    email: string,
    displayName: string,
  ): Promise<string> {
    clerk.setMembership({
      clerkOrgId: OWNER_ORG_ID,
      clerkUserId: token,
      clerkMembershipId: `orgmem_${token}`,
      role: "org:member",
    });
    return signIn(token, email, displayName);
  }

  /** One reviewed manual line: a bottle feed with no measured amount. */
  function feedCandidate(): Record<string, unknown> {
    return {
      id: feedCandidateId,
      kind: "feed",
      occurredAt: feedOccurredAt,
      endedAt: null,
      timePrecision: "exact",
      amountValue: null,
      amountUnit: null,
      details: { kind: "feed", method: "bottle" },
      important: false,
      sourceQuote: null,
      sourceStart: null,
      sourceEnd: null,
      ambiguities: [],
      discarded: false,
    };
  }

  function manualCaptureBody(): string {
    return JSON.stringify({
      childId,
      clientCaptureId: randomUUID(),
      inputKind: "manual",
      capturedAt: new Date().toISOString(),
      timezone: "America/Vancouver",
      locale: "en-CA",
      candidates: [feedCandidate()],
    });
  }

  function confirmBody(important = false): string {
    const { sourceStart: _start, sourceEnd: _end, ...reviewed } = feedCandidate();
    return JSON.stringify({
      expectedDraftVersion: capturedDraftVersion,
      candidates: [{ ...reviewed, important }],
    });
  }

  async function readOverview(token: string): Promise<OverviewDto> {
    const response = await overviewRoute.GET(
      jsonRequest("GET", `/v1/children/${childId}/overview`, { headers: authorized(token) }),
      { childId },
    );
    expect(response.status).toBe(200);
    return overviewDtoSchema.parse(await readBody(response));
  }

  async function actOnCare(token: string, action: "start" | "end"): Promise<Response> {
    return careRoute.POST(
      jsonRequest("POST", `/v1/children/${childId}/care`, {
        headers: authorized(token, randomUUID()),
        body: JSON.stringify({ action }),
      }),
      { childId },
    );
  }

  async function createBriefFor(token: string): Promise<Response> {
    return childHandoffsRoute.POST(
      jsonRequest("POST", `/v1/children/${childId}/handoffs`, {
        headers: authorized(token, randomUUID()),
      }),
      { childId },
    );
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

    recipientUserId = await joinOwnerWorkspace(
      RECIPIENT_TOKEN,
      "route-recipient@example.test",
      "Route Recipient",
    );
    readerUserId = await joinOwnerWorkspace(
      READER_TOKEN,
      "route-reader@example.test",
      "Route Reader",
    );
    const granted = await caregiversRoute.PATCH(
      jsonRequest("PATCH", `/v1/children/${childId}/caregivers`, {
        headers: authorized(OWNER_TOKEN, randomUUID()),
        body: JSON.stringify({
          grants: [
            { userId: recipientUserId, relationship: "caregiver", permission: "contributor" },
            { userId: readerUserId, relationship: "relative", permission: "reader" },
          ],
        }),
      }),
      { childId },
    );
    expect(granted.status).toBe(200);
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

  it("refuses a reader's manual entry with 403 rather than a 404", async () => {
    const response = await capturesRoute.POST(
      jsonRequest("POST", "/v1/captures", {
        headers: authorized(READER_TOKEN, randomUUID()),
        body: manualCaptureBody(),
      }),
    );
    expect(response.status).toBe(403);
    expect((await readBody(response)).code).toBe("forbidden");
  });

  it("allocates a manual capture holding one reviewed entry", async () => {
    const response = await capturesRoute.POST(
      jsonRequest("POST", "/v1/captures", {
        headers: authorized(OWNER_TOKEN, randomUUID()),
        body: manualCaptureBody(),
      }),
    );
    expect(response.status).toBe(201);
    const capture = captureDtoSchema.parse(await readBody(response));
    expect(capture.status).toBe("needs_review");
    expect(capture.draft?.candidates.map((entry) => entry.id)).toEqual([feedCandidateId]);
    captureId = capture.id;
    capturedDraftVersion = capture.draftVersion;
  });

  it("confirms that capture into exactly one event", async () => {
    const response = await confirmCaptureRoute.POST(
      jsonRequest("POST", `/v1/captures/${captureId}/confirm`, {
        headers: authorized(OWNER_TOKEN, confirmKey),
        body: confirmBody(),
      }),
      { captureId },
    );
    expect(response.status).toBe(200);
    const confirmed = confirmCaptureResponseSchema.parse(await readBody(response));
    expect(confirmed.capture.status).toBe("confirmed");
    expect(confirmed.events).toHaveLength(1);
    const [event] = confirmed.events;
    expect(event?.kind).toBe("feed");
    expect(event?.version).toBe(1);
    feedEventId = event?.id ?? "";
  });

  it("replays the same confirmation key onto the same event", async () => {
    const response = await confirmCaptureRoute.POST(
      jsonRequest("POST", `/v1/captures/${captureId}/confirm`, {
        headers: authorized(OWNER_TOKEN, confirmKey),
        body: confirmBody(),
      }),
      { captureId },
    );
    expect(response.status).toBe(200);
    const replayed = confirmCaptureResponseSchema.parse(await readBody(response));
    expect(replayed.events.map((event) => event.id)).toEqual([feedEventId]);
  });

  it("rejects that key when the confirmed body differs", async () => {
    const response = await confirmCaptureRoute.POST(
      jsonRequest("POST", `/v1/captures/${captureId}/confirm`, {
        headers: authorized(OWNER_TOKEN, confirmKey),
        body: confirmBody(true),
      }),
      { captureId },
    );
    expect(response.status).toBe(409);
    expect((await readBody(response)).code).toBe("idempotency_key_reused");
  });

  it("reads the confirmed capture back for its author", async () => {
    const response = await captureRoute.GET(
      jsonRequest("GET", `/v1/captures/${captureId}`, { headers: authorized(OWNER_TOKEN) }),
      { captureId },
    );
    expect(response.status).toBe(200);
    expect(captureDtoSchema.parse(await readBody(response)).confirmedAt).not.toBeNull();
  });

  it("shows the feed as latest known care, unread for everyone who has not acknowledged", async () => {
    const forRecipient = await readOverview(RECIPIENT_TOKEN);
    expect(forRecipient.latest.feed?.eventId).toBe(feedEventId);
    expect(forRecipient.recentActivity.map((event) => event.id)).toContain(feedEventId);
    expect(forRecipient.unreadChangeCount).toBe(1);

    // The cursor is per recipient, and the author has acknowledged nothing either, so their own
    // published change counts as unread for them too until they mark a handoff read.
    expect((await readOverview(OWNER_TOKEN)).unreadChangeCount).toBe(1);
  });

  it("pages the confirmed timeline and refuses a cursor it never issued", async () => {
    const page = await childEventsRoute.GET(
      jsonRequest("GET", `/v1/children/${childId}/events?kind=feed`, {
        headers: authorized(RECIPIENT_TOKEN),
      }),
      { childId },
    );
    expect(page.status).toBe(200);
    const events = eventsPageSchema.parse(await readBody(page));
    expect(events.items.map((event) => event.id)).toEqual([feedEventId]);
    expect(events.nextCursor).toBeNull();

    const rejected = await childEventsRoute.GET(
      jsonRequest("GET", `/v1/children/${childId}/events?cursor=not-a-cursor`, {
        headers: authorized(RECIPIENT_TOKEN),
      }),
      { childId },
    );
    expect(rejected.status).toBe(422);
    expect((await readBody(rejected)).code).toBe("validation_failed");
  });

  it("refuses a correction that carries a stale expected version", async () => {
    const response = await eventRoute.PATCH(
      jsonRequest("PATCH", `/v1/events/${feedEventId}`, {
        headers: authorized(OWNER_TOKEN, randomUUID()),
        body: JSON.stringify({ expectedVersion: 99, amountValue: "90", amountUnit: "ml" }),
      }),
      { eventId: feedEventId },
    );
    expect(response.status).toBe(409);
    expect((await readBody(response)).code).toBe("conflict");
  });

  it("publishes a correction as the event's second version", async () => {
    const response = await eventRoute.PATCH(
      jsonRequest("PATCH", `/v1/events/${feedEventId}`, {
        headers: authorized(OWNER_TOKEN, randomUUID()),
        body: JSON.stringify({ expectedVersion: 1, amountValue: "90", amountUnit: "ml" }),
      }),
      { eventId: feedEventId },
    );
    expect(response.status).toBe(200);
    const corrected = eventDtoSchema.parse(await readBody(response));
    expect(corrected.version).toBe(2);
    expect(corrected.amountUnit).toBe("ml");
  });

  it("opens one care session however many times the recipient asks", async () => {
    const first = await actOnCare(RECIPIENT_TOKEN, "start");
    expect(first.status).toBe(200);
    const session = careSessionDtoSchema.parse(await readBody(first));

    const again = await actOnCare(RECIPIENT_TOKEN, "start");
    expect(again.status).toBe(200);
    expect(careSessionDtoSchema.parse(await readBody(again)).id).toBe(session.id);

    const list = await careRoute.GET(
      jsonRequest("GET", `/v1/children/${childId}/care`, { headers: authorized(OWNER_TOKEN) }),
      { childId },
    );
    expect(list.status).toBe(200);
    const open = careListResponseSchema.parse(await readBody(list));
    expect(open.sessions.map((active) => active.id)).toEqual([session.id]);
  });

  it("ends the caller's own session and then has nothing left to end", async () => {
    const ended = await actOnCare(RECIPIENT_TOKEN, "end");
    expect(ended.status).toBe(200);
    expect(careSessionDtoSchema.parse(await readBody(ended)).endedAt).not.toBeNull();

    const nothing = await actOnCare(RECIPIENT_TOKEN, "end");
    expect(nothing.status).toBe(404);
    expect((await readBody(nothing)).code).toBe("not_found");
  });

  it("creates a brief only its recipient can open", async () => {
    const created = await createBriefFor(RECIPIENT_TOKEN);
    expect(created.status).toBe(201);
    const brief = handoffBriefDtoSchema.parse(await readBody(created));
    expect(brief.recipientUserId).toBe(recipientUserId);
    expect(brief.snapshot.updates.map((entry) => entry.eventId)).toEqual([feedEventId]);
    briefId = brief.id;

    const otherReader = await briefRoute.GET(
      jsonRequest("GET", `/v1/handoffs/${briefId}`, { headers: authorized(OWNER_TOKEN) }),
      { briefId },
    );
    expect(otherReader.status).toBe(404);

    const owned = await briefRoute.GET(
      jsonRequest("GET", `/v1/handoffs/${briefId}`, { headers: authorized(RECIPIENT_TOKEN) }),
      { briefId },
    );
    expect(owned.status).toBe(200);
    expect(handoffBriefDtoSchema.parse(await readBody(owned)).isStale).toBe(false);
  });

  it("acknowledges the brief with a care session and replays the same cursor", async () => {
    const key = randomUUID();
    const body = JSON.stringify({ startCare: true });
    const path = `/v1/handoffs/${briefId}/acknowledge`;

    const first = await acknowledgeRoute.POST(
      jsonRequest("POST", path, { headers: authorized(RECIPIENT_TOKEN, key), body }),
      { briefId },
    );
    expect(first.status).toBe(200);
    const acknowledged = acknowledgeBriefResponseSchema.parse(await readBody(first));
    expect(acknowledged.session?.userId).toBe(recipientUserId);
    expect(acknowledged.acknowledgedSeq).toBe(
      acknowledged.brief.snapshot.boundary.throughSeqInclusive,
    );

    const replay = await acknowledgeRoute.POST(
      jsonRequest("POST", path, { headers: authorized(RECIPIENT_TOKEN, key), body }),
      { briefId },
    );
    expect(replay.status).toBe(200);
    const replayed = acknowledgeBriefResponseSchema.parse(await readBody(replay));
    expect(replayed.acknowledgedSeq).toBe(acknowledged.acknowledgedSeq);
    expect(replayed.session?.id).toBe(acknowledged.session?.id);
  });

  it("leaves the recipient with nothing unread and the author's count untouched", async () => {
    const forRecipient = await readOverview(RECIPIENT_TOKEN);
    expect(forRecipient.unreadChangeCount).toBe(0);
    expect(forRecipient.activeSessions.map((session) => session.userId)).toEqual([recipientUserId]);

    // Acknowledging is caller specific: one reader's cursor cannot move another's count.
    expect((await readOverview(OWNER_TOKEN)).unreadChangeCount).toBe(2);
  });

  it("removes the entry and reports it as removed in the next brief", async () => {
    const removed = await eventRoute.DELETE(
      jsonRequest("DELETE", `/v1/events/${feedEventId}`, {
        headers: authorized(OWNER_TOKEN, randomUUID()),
        body: JSON.stringify({ expectedVersion: 2 }),
      }),
      { eventId: feedEventId },
    );
    expect(removed.status).toBe(200);
    expect(eventDtoSchema.parse(await readBody(removed)).status).toBe("deleted");

    const next = await createBriefFor(RECIPIENT_TOKEN);
    expect(next.status).toBe(201);
    const brief = handoffBriefDtoSchema.parse(await readBody(next));
    expect(brief.snapshot.boundary.fromSeqExclusive).toBe(2);
    expect(brief.snapshot.updates).toEqual([
      expect.objectContaining({ eventId: feedEventId, label: "removed" }),
    ]);
    // A removed entry is no longer recorded care, so it stops being the latest known fact.
    expect((await readOverview(RECIPIENT_TOKEN)).latest.feed).toBeNull();
  });
});
