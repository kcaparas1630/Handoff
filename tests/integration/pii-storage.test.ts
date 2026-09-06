import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/client";
import { createDataKeyStore } from "../../packages/db/src/repositories/data-keys";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { ApiHttpError } from "../../packages/server/src/http/errors";
import { runIdempotent } from "../../packages/server/src/http/idempotency";
import { workspaceScope } from "../../packages/server/src/lib/record-contexts";
import { createDataKeyService } from "../../packages/server/src/security/encryption/data-keys";
import { createDevelopmentKeyWrapper } from "../../packages/server/src/security/encryption/development-key-wrapper";
import { bootstrap } from "../../packages/server/src/services/bootstrap";
import { confirmCapture } from "../../packages/server/src/services/capture-confirmation";
import { createCapture } from "../../packages/server/src/services/captures";
import { createChild, getChild } from "../../packages/server/src/services/children";
import { getEvent } from "../../packages/server/src/services/events";
import { createBrief, getBrief } from "../../packages/server/src/services/handoffs";
import { createInvitation, getInvitation } from "../../packages/server/src/services/invitations";
import { initializeWorkspace } from "../../packages/server/src/services/workspaces";
import { candidate } from "./support/journal-fixtures";
import type { DbClient } from "../../packages/db/src/client";
import type { ServiceDeps } from "../../packages/server/src/types/runtime";
import { createFakeClerkGateway } from "./support/fake-clerk-gateway";
import type { TestDatabase } from "./support/test-database";
import { createTestDatabase, missingDatabaseUrlMessage } from "./support/test-database";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping PII storage tests. ${missingDatabaseUrlMessage}`);

// Synthetic markers. Every one of these is personal data in production terms.
const MARKERS = {
  userName: "Marker-User-9f3a",
  workspaceName: "Marker-Workspace-9f3a",
  childName: "Marker-Child-9f3a",
  otherChildName: "Marker-Other-9f3a",
  birthdate: "2024-03-17",
  email: "marker-invite-9f3a@example.test",
  idempotentBody: "Marker-Idempotent-9f3a",
  eventNote: "Marker-Note-9f3a",
  milestoneQuote: "Marker-Quote-9f3a",
  sourceQuote: "Marker-Transcript-9f3a",
  spokenText: "Marker-Spoken-9f3a",
};

async function dumpDatabase(adminUrl: string): Promise<string> {
  const session = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const tables = await session<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'handoff' and table_type = 'BASE TABLE'
      order by table_name
    `;
    const chunks: string[] = [];
    for (const { table_name: tableName } of tables) {
      const rows = await session.unsafe(
        `select coalesce(json_agg(t)::text, '[]') as dump from handoff."${tableName}" t`,
      );
      chunks.push(`${tableName}: ${String(rows[0]?.dump ?? "[]")}`);
    }
    return chunks.join("\n");
  } finally {
    await session.end();
  }
}

describeIntegration("personal data at rest", () => {
  let database: TestDatabase;
  let api: DbClient;
  let admin: DbClient;
  let deps: ServiceDeps;
  let workspaceId: string;
  let ownerId: string;
  let childId: string;
  let otherChildId: string;
  let invitationId: string;
  let noteEventId: string;
  let milestoneEventId: string;
  let briefId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    api = createDbClient({ url: database.apiUrl, maxConnections: 10 });
    admin = createDbClient({ url: database.adminUrl, maxConnections: 2 });
    const clerk = createFakeClerkGateway();
    const keyWrapper = createDevelopmentKeyWrapper(randomBytes(32).toString("base64"));
    deps = {
      db: api.db,
      keys: createDataKeyService({ store: createDataKeyStore(api.db), wrapper: keyWrapper }),
      keyWrapper,
      clerk,
      guardianRoleKey: "org:guardian",
      invitationRedirectUrl: "https://handoff.test/accept-invitation",
      storage: null,
      jobsDb: null,
      requestId: randomUUID(),
      now: () => new Date(),
    };

    clerk.setUser("user_marker", "owner@example.test");
    const owner = await bootstrap({
      deps,
      clerkUserId: "user_marker",
      displayName: MARKERS.userName,
    });
    ownerId = owner.user.id;
    clerk.setMembership({
      clerkOrgId: "org_marker",
      clerkUserId: "user_marker",
      clerkMembershipId: "orgmem_marker",
      role: "org:admin",
    });
    const workspace = await initializeWorkspace({
      deps,
      userId: ownerId,
      clerkUserId: "user_marker",
      input: {
        clerkOrgId: "org_marker",
        kind: "daycare",
        name: MARKERS.workspaceName,
        timezone: "UTC",
      },
    });
    workspaceId = workspace.id;

    const child = await createChild({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: { name: MARKERS.childName, birthdate: MARKERS.birthdate },
    });
    childId = child.id;
    const otherChild = await createChild({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: { name: MARKERS.otherChildName },
    });
    otherChildId = otherChild.id;

    const invitation = await createInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      input: {
        email: MARKERS.email,
        intendedAppRole: "guardian",
        childGrants: [{ childId, relationship: "parent", permission: "reader" }],
      },
    });
    invitationId = invitation.id;

    const noteCandidate = candidate({
      kind: "note",
      occurredAt: new Date().toISOString(),
      sourceQuote: MARKERS.sourceQuote,
      details: { kind: "note", text: MARKERS.eventNote, intent: "observation" },
    });
    const milestoneCandidate = candidate({
      kind: "milestone",
      occurredAt: new Date().toISOString(),
      details: {
        kind: "milestone",
        description: "First word",
        quote: MARKERS.milestoneQuote,
        reportedFirst: true,
      },
    });
    const capture = await createCapture({
      deps,
      actorUserId: ownerId,
      input: {
        childId,
        clientCaptureId: randomUUID(),
        inputKind: "manual",
        capturedAt: new Date().toISOString(),
        timezone: "UTC",
        locale: "en-CA",
        candidates: [noteCandidate, milestoneCandidate],
      },
    });
    const confirmed = await confirmCapture({
      deps,
      actorUserId: ownerId,
      captureId: capture.id,
      input: {
        expectedDraftVersion: capture.draftVersion,
        candidates: [noteCandidate, milestoneCandidate].map(
          ({ sourceStart: _s, sourceEnd: _e, ...rest }) => rest,
        ),
      },
    });
    noteEventId = confirmed.events[0]?.id ?? "";
    milestoneEventId = confirmed.events[1]?.id ?? "";
    briefId = (await createBrief({ deps, actorUserId: ownerId, childId })).id;

    // A typed capture stores its text as the raw transcript and queues one job, so the dump also
    // covers what reaches the queue: jobs keep ids, never provider text (docs/pii-encryption.md).
    await createCapture({
      deps,
      actorUserId: ownerId,
      input: {
        childId,
        clientCaptureId: randomUUID(),
        inputKind: "text",
        capturedAt: new Date().toISOString(),
        timezone: "UTC",
        locale: "en-CA",
        text: MARKERS.spokenText,
      },
    });

    await withTenantTransaction(api.db, { workspaceId }, (tx) =>
      runIdempotent({
        tx,
        keys: deps.keys,
        actor: { userId: ownerId },
        operation: "children.create",
        key: randomUUID(),
        scope: workspaceScope(workspaceId),
        requestBody: JSON.stringify({ name: MARKERS.idempotentBody }),
        now: deps.now,
        execute: () => Promise.resolve({ status: 201, body: { name: MARKERS.idempotentBody } }),
      }),
    );
  }, 90_000);

  afterAll(async () => {
    await api?.close();
    await admin?.close();
    await database?.drop();
  });

  it("keeps every marker out of a full plaintext dump of every table", async () => {
    const dump = await dumpDatabase(database.adminUrl);
    expect(dump).toContain("children:");
    expect(dump).toContain("idempotency_requests:");
    // The queue is dumped with everything else: its payloads and checkpoints are in scope here.
    expect(dump).toContain("jobs:");
    for (const [name, marker] of Object.entries(MARKERS)) {
      expect(`${name}: ${dump.includes(marker) ? "leaked" : "absent"}`).toBe(`${name}: absent`);
    }
  });

  it("returns the markers to an authorized reader", async () => {
    const child = await getChild({ deps, actorUserId: ownerId, workspaceId, childId });
    expect(child.name).toBe(MARKERS.childName);
    expect(child.birthdate).toBe(MARKERS.birthdate);

    const invitation = await getInvitation({
      deps,
      actorUserId: ownerId,
      workspaceId,
      invitationId,
    });
    expect(invitation.inviteeEmail).toBe(MARKERS.email);

    const self = await bootstrap({ deps, clerkUserId: "user_marker" });
    expect(self.user.displayName).toBe(MARKERS.userName);
    expect(self.workspaces[0]?.name).toBe(MARKERS.workspaceName);
  });

  it("returns journal text, quotes, and the stored brief to an authorized reader", async () => {
    const note = await getEvent({ deps, actorUserId: ownerId, eventId: noteEventId });
    expect(note.details).toMatchObject({ kind: "note", text: MARKERS.eventNote });
    // The source quote lives in the revision snapshot, not in a column.
    expect(note.sourceQuote).toBe(MARKERS.sourceQuote);

    const milestone = await getEvent({ deps, actorUserId: ownerId, eventId: milestoneEventId });
    expect(milestone.details).toMatchObject({ quote: MARKERS.milestoneQuote });

    const brief = await getBrief({ deps, actorUserId: ownerId, briefId });
    const rendered = JSON.stringify(brief.snapshot);
    expect(rendered).toContain(MARKERS.eventNote);
    expect(rendered).toContain(MARKERS.milestoneQuote);
  });

  it("replays a stored idempotent response and rejects a reused key with a new body", async () => {
    const key = randomUUID();
    const first = await withTenantTransaction(api.db, { workspaceId }, (tx) =>
      runIdempotent({
        tx,
        keys: deps.keys,
        actor: { userId: ownerId },
        operation: "invitations.create",
        key,
        scope: workspaceScope(workspaceId),
        requestBody: JSON.stringify({ email: MARKERS.email }),
        now: deps.now,
        execute: () => Promise.resolve({ status: 201, body: { email: MARKERS.email } }),
      }),
    );
    const replay = await withTenantTransaction(api.db, { workspaceId }, (tx) =>
      runIdempotent({
        tx,
        keys: deps.keys,
        actor: { userId: ownerId },
        operation: "invitations.create",
        key,
        scope: workspaceScope(workspaceId),
        requestBody: JSON.stringify({ email: MARKERS.email }),
        now: deps.now,
        // A replay must never run the effect again.
        execute: () => Promise.reject(new Error("the stored response should have been replayed")),
      }),
    );
    expect(replay).toEqual(first);

    let reuse: unknown;
    try {
      await withTenantTransaction(api.db, { workspaceId }, (tx) =>
        runIdempotent({
          tx,
          keys: deps.keys,
          actor: { userId: ownerId },
          operation: "invitations.create",
          key,
          scope: workspaceScope(workspaceId),
          requestBody: JSON.stringify({ email: "someone-else@example.test" }),
          now: deps.now,
          execute: () => Promise.resolve({ status: 201, body: {} }),
        }),
      );
    } catch (error) {
      reuse = error;
    }
    expect(reuse).toBeInstanceOf(ApiHttpError);
    expect((reuse as ApiHttpError).status).toBe(409);
    expect((reuse as ApiHttpError).code).toBe("idempotency_key_reused");
  });

  it("fails closed when one child's ciphertext is copied onto another row", async () => {
    const session = postgres(database.adminUrl, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await session`
        update handoff.children as target
        set profile_ciphertext = source.profile_ciphertext
        from handoff.children as source
        where target.id = ${otherChildId} and source.id = ${childId}
      `;
    } finally {
      await session.end();
    }

    let failure: unknown;
    try {
      await getChild({ deps, actorUserId: ownerId, workspaceId, childId: otherChildId });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : "";
    // No plaintext escapes, and the row certainly does not become the other child.
    expect(message).not.toContain(MARKERS.childName);
    expect(message).not.toContain(MARKERS.otherChildName);
  });

  it("fails closed when the authentication tag is tampered with", async () => {
    const session = postgres(database.adminUrl, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await session`
        update handoff.children
        set profile_ciphertext = jsonb_set(
          profile_ciphertext,
          '{tag}',
          to_jsonb('AAAAAAAAAAAAAAAAAAAAAA=='::text)
        )
        where id = ${childId}
      `;
    } finally {
      await session.end();
    }

    let failure: unknown;
    try {
      await getChild({ deps, actorUserId: ownerId, workspaceId, childId });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure instanceof Error ? failure.message : "").not.toContain(MARKERS.childName);
  });
});
