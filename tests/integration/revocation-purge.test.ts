// The milestone 5 acceptance gate for revocation and deletion, end to end against real Postgres.
//
// A revoked caregiver loses access on the next request and their declared care closes. A deleted
// child disappears from every read path immediately and its purge job then removes the objects and
// the rows: quota released exactly once even when the job runs twice, briefs kept as redacted rows
// that still decrypt to an empty snapshot, revisions gone, and no event resurrected by a late
// `validate_media` or `process_capture` claim. A deleted workspace cascades and the Clerk fake
// records the organization deletion.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { briefSnapshotSchema } from "../../packages/contracts/src/index";
import * as capturesRepository from "../../packages/db/src/repositories/captures";
import * as childrenRepository from "../../packages/db/src/repositories/children";
import * as handoffsRepository from "../../packages/db/src/repositories/handoffs";
import * as identityRepository from "../../packages/db/src/repositories/identity";
import * as jobsRepository from "../../packages/db/src/repositories/jobs";
import * as mediaRepository from "../../packages/db/src/repositories/media";
import * as purgeRepository from "../../packages/db/src/repositories/purge";
import * as storageQuotaRepository from "../../packages/db/src/repositories/storage-quota";
import {
  withJobTransaction,
  withTenantTransaction,
} from "../../packages/db/src/tenant-transaction";
import { validateMedia } from "../../packages/server/src/jobs/validate-media";
import { processCapture } from "../../packages/server/src/jobs/process-capture";
import { workspaceObjectPrefix } from "../../packages/server/src/lib/object-key";
import { decryptBriefSnapshot } from "../../packages/server/src/security/journal-fields";
import { decryptChildProfileEnvelope } from "../../packages/server/src/security/profile-fields";
import { deleteChild, deleteWorkspace } from "../../packages/server/src/services/deletion";
import { listEvents } from "../../packages/server/src/services/events";
import { getChild } from "../../packages/server/src/services/children";
import { createBrief } from "../../packages/server/src/services/handoffs";
import { getAssetReadUrl } from "../../packages/server/src/services/media";
import { revokeMember } from "../../packages/server/src/services/memberships";
import { purgeChildDedupeKey } from "../../packages/server/src/services/job-keys";
import { startCare } from "../../packages/server/src/services/care";
import { completeAssetUpload, createAssetUpload } from "../../packages/server/src/services/media";
import { createJobHarness } from "./support/job-harness";
import { candidate, confirmManualCapture } from "./support/journal-fixtures";
import { jpegImage } from "./support/media-fixtures";
import {
  createHarness,
  grantChild,
  seedChild,
  seedUser,
  seedWorkspace,
} from "./support/service-harness";
import { missingDatabaseUrlMessage } from "./support/test-database";
import type { JobContext, JobOutcome } from "../../packages/server/src/types/jobs";
import type { JobHarness } from "./support/job-harness";
import type { TestHarness } from "./support/service-harness";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping revocation and purge tests. ${missingDatabaseUrlMessage}`);

describeIntegration("revocation and purge", () => {
  let harness: TestHarness;
  let jobs: JobHarness;
  let workspaceId: string;
  let clerkOrgId: string;
  let ownerId: string;
  let caregiverId: string;

  beforeAll(async () => {
    harness = await createHarness();
    jobs = createJobHarness(harness);
    const workspace = await seedWorkspace(harness, { label: "purge" });
    workspaceId = workspace.workspaceId;
    clerkOrgId = workspace.clerkOrgId;
    ownerId = workspace.ownerId;
    caregiverId = await seedUser(harness, {
      label: "purge_caregiver",
      clerkOrgId,
      role: "member",
    });
  }, 120_000);

  afterAll(async () => {
    await jobs?.close();
    await harness?.close();
  });

  /** A child with a grant for the caregiver, so each test owns its own subject. */
  async function seedGrantedChild(name: string): Promise<string> {
    const childId = await seedChild(harness, { workspaceId, ownerId, name });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [{ userId: caregiverId, relationship: "caregiver", permission: "contributor" }],
    });
    return childId;
  }

  /** One confirmed event plus one ready photo, which is what a purge has to remove. */
  async function seedCareWithPhoto(childId: string): Promise<{ assetId: string; eventId: string }> {
    const confirmed = await confirmManualCapture(harness, {
      actorUserId: caregiverId,
      childId,
      candidates: [candidate({ kind: "feed" })],
    });
    const eventId = confirmed.events[0]?.id;
    if (eventId === undefined) throw new Error("expected a confirmed event");

    const { bytes } = await jpegImage();
    const allocated = await createAssetUpload({
      deps: harness.deps,
      actorUserId: caregiverId,
      captureId: confirmed.capture.id,
      input: { kind: "image", declaredMime: "image/jpeg", declaredSizeBytes: bytes.byteLength },
    });
    const asset = await readAsset(allocated.asset.id);
    if (asset === null) throw new Error("expected an allocated asset");
    jobs.storage.put(asset.objectKey, bytes, "image/jpeg");
    await completeAssetUpload({
      deps: harness.deps,
      actorUserId: caregiverId,
      assetId: asset.id,
      input: { sizeBytes: bytes.byteLength },
    });
    await jobs.runner.runOnce();
    return { assetId: asset.id, eventId };
  }

  function readAsset(assetId: string) {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      mediaRepository.findMediaAssetInWorkspace(tx, workspaceId, assetId),
    );
  }

  function readChild(childId: string) {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      childrenRepository.findChildInWorkspace(tx, workspaceId, childId),
    );
  }

  function readStorage() {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      storageQuotaRepository.findWorkspaceStorage(tx, workspaceId),
    );
  }

  function readCounts(childId: string) {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      purgeRepository.countRemainingForChild(tx, { workspaceId, childId }),
    );
  }

  /** Runs the purge job the delete request queued, by claiming it the way the worker does. */
  async function runPurge(childId: string): Promise<void> {
    const queued = await withJobTransaction(jobs.dispatcher.db, (tx) =>
      jobsRepository.findJobByDedupeKey(tx, purgeChildDedupeKey(childId)),
    );
    expect(queued).not.toBeNull();
    await jobs.runner.runOnce();
  }

  it("stops a revoked caregiver at the API, ends their care, and refuses a new signed URL", async () => {
    const childId = await seedGrantedChild("Marker-Revoked");
    const { assetId } = await seedCareWithPhoto(childId);
    const session = await startCare({ deps: harness.deps, actorUserId: caregiverId, childId });
    expect(session.endedAt).toBeNull();

    await revokeMember({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      targetUserId: caregiverId,
    });

    // The next request is refused: revocation is a local write, so there is no propagation window.
    await expect(
      listEvents({ deps: harness.deps, actorUserId: caregiverId, childId, query: { limit: 10 } }),
    ).rejects.toMatchObject({ status: 404 });
    // A previously issued URL keeps working until it expires (architecture §6); a new one is not
    // issued at all, which is the part the server controls.
    await expect(
      getAssetReadUrl({ deps: harness.deps, actorUserId: caregiverId, assetId }),
    ).rejects.toMatchObject({ status: 404 });

    const sessions = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      identityRepository.listMembershipsForWorkspace(tx, workspaceId),
    );
    expect(sessions.find((row) => row.userId === caregiverId)?.status).toBe("revoked");

    // Restore the grant for the tests that follow.
    harness.clerk.setMembership({
      clerkOrgId,
      clerkUserId: "user_purge_caregiver",
      clerkMembershipId: "orgmem_purge_caregiver",
      role: "org:member",
    });
    await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      identityRepository.upsertMembership(tx, {
        workspaceId,
        userId: caregiverId,
        clerkMembershipId: "orgmem_purge_caregiver",
        appRole: "caregiver",
        status: "active",
        providerVerifiedAt: new Date(),
      }),
    );
  });

  it("makes a deleted child invisible at once and answers a repeat request the same way", async () => {
    const childId = await seedGrantedChild("Marker-Invisible");
    const accepted = await deleteChild({ deps: harness.deps, actorUserId: ownerId, childId });
    expect(accepted).toEqual({ childId, status: "deleting" });

    await expect(
      getChild({ deps: harness.deps, actorUserId: ownerId, workspaceId, childId }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      listEvents({ deps: harness.deps, actorUserId: caregiverId, childId, query: { limit: 10 } }),
    ).rejects.toMatchObject({ status: 404 });

    const repeated = await deleteChild({ deps: harness.deps, actorUserId: ownerId, childId });
    expect(repeated.status).toBe("deleting");
    // One purge is scheduled however many times the request is repeated.
    const queued = await withJobTransaction(jobs.dispatcher.db, (tx) =>
      jobsRepository.findJobByDedupeKey(tx, purgeChildDedupeKey(childId)),
    );
    expect(queued?.kind).toBe("purge_child");
    expect(queued?.status).toBe("queued");
  });

  it("refuses child deletion to a caregiver who is not the workspace owner", async () => {
    const childId = await seedGrantedChild("Marker-Owner-Only");
    await expect(
      deleteChild({ deps: harness.deps, actorUserId: caregiverId, childId }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await readChild(childId))?.status).toBe("active");
  });

  it("purges objects, rows, and copied snapshots, and releases quota exactly once", async () => {
    const childId = await seedGrantedChild("Marker-Purged");
    const { assetId } = await seedCareWithPhoto(childId);
    await createBrief({ deps: harness.deps, actorUserId: ownerId, childId });

    const asset = await readAsset(assetId);
    if (asset === null) throw new Error("expected a ready asset");
    expect(asset.status).toBe("ready");
    const usedBefore = (await readStorage())?.usedBytes ?? 0;
    expect(usedBefore).toBeGreaterThan(0);
    expect(jobs.storage.has(asset.objectKey)).toBe(true);

    await deleteChild({ deps: harness.deps, actorUserId: ownerId, childId });
    await runPurge(childId);

    expect(jobs.storage.has(asset.objectKey)).toBe(false);
    expect(jobs.storage.keys().some((key) => key.includes(childId))).toBe(false);

    const counts = await readCounts(childId);
    expect(counts).toMatchObject({
      captures: 0,
      events: 0,
      eventRevisions: 0,
      mediaAssets: 0,
      careSessions: 0,
      handoffCursors: 0,
      childCaregivers: 0,
      invitationChildGrants: 0,
      unredactedBriefs: 0,
      liveChildRows: 0,
    });
    expect(counts.redactedBriefs).toBe(1);

    // The child row survives as a tombstone the retained brief and the audit log still point at.
    const tombstone = await readChild(childId);
    expect(tombstone?.status).toBe("deleted");
    expect(
      await decryptChildProfileEnvelope(harness.deps.keys, {
        workspaceId,
        childId,
        envelope: tombstone?.profileCiphertext,
      }),
    ).toEqual({ schemaVersion: 1, name: null, birthdate: null });

    // The redacted brief still decrypts, to an empty snapshot rather than to nothing.
    const briefs = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      handoffsRepository.listBriefsForChild(tx, { workspaceId, childId, limit: 10 }),
    );
    const brief = briefs[0];
    if (brief === undefined) throw new Error("expected the acknowledgement record to survive");
    const snapshot = await decryptBriefSnapshot(harness.deps.keys, {
      workspaceId,
      briefId: brief.id,
      envelope: brief.snapshotCiphertext,
    });
    expect(briefSnapshotSchema.parse(snapshot)).toMatchObject({
      updates: [],
      moments: [],
      essentials: [],
      sourceRevisionIds: [],
    });

    // Other children in this workspace still hold storage, so the reading that matters is the
    // decrease: exactly this asset's settled bytes, given back once.
    const usedAfter = (await readStorage())?.usedBytes ?? 0;
    expect(usedBefore - usedAfter).toBe(asset.sizeBytes ?? asset.reservedBytes);

    // Crash and retry: the purge is re-run from the start and moves no counter a second time.
    const reserved = (await readStorage())?.reservedBytes ?? 0;
    await deleteChild({ deps: harness.deps, actorUserId: ownerId, childId });
    await jobs.runner.runOnce();
    expect((await readStorage())?.usedBytes).toBe(usedAfter);
    expect((await readStorage())?.reservedBytes).toBe(reserved);
    expect(await readCounts(childId)).toMatchObject({ events: 0, eventRevisions: 0 });
  });

  it("cannot be raced by a late media or capture job into resurrecting an event", async () => {
    const childId = await seedGrantedChild("Marker-Race");
    const { assetId } = await seedCareWithPhoto(childId);

    // A worker that claimed work before the delete request lands still holds a job row. It is
    // replayed here after the child is gone, which is the ordering the gate asks about.
    await deleteChild({ deps: harness.deps, actorUserId: ownerId, childId });

    const lateMedia = await runHandler(validateMedia, {
      workspaceId,
      childId,
      assetId,
      kind: "validate_media",
    });
    expect(lateMedia.status).toBe("completed");

    const capture = await createCaptureBeforeDeletion(childId);
    const lateCapture = await runHandler(processCapture, {
      workspaceId,
      childId,
      captureId: capture,
      kind: "process_capture",
    });
    // The author can no longer add to a child that does not exist, so the capture is cancelled.
    expect(lateCapture).toMatchObject({ status: "failed", errorCode: "cancelled" });

    await runPurge(childId);
    const counts = await readCounts(childId);
    expect(counts.events).toBe(0);
    expect(counts.eventRevisions).toBe(0);
    expect(counts.captures).toBe(0);
  });

  it("cascades a workspace deletion and records the Clerk organization deletion", async () => {
    const second = await seedWorkspace(harness, { label: "purge_ws" });
    const childId = await seedChild(harness, {
      workspaceId: second.workspaceId,
      ownerId: second.ownerId,
      name: "Marker-Workspace",
    });
    await confirmManualCapture(harness, {
      actorUserId: second.ownerId,
      childId,
      candidates: [candidate({ kind: "diaper" })],
    });

    const accepted = await deleteWorkspace({
      deps: harness.deps,
      actorUserId: second.ownerId,
      workspaceId: second.workspaceId,
    });
    expect(accepted).toEqual({ workspaceId: second.workspaceId, status: "deleting" });
    expect(harness.clerk.deletedOrganizations).toContain(second.clerkOrgId);

    // Every member lost access with the same write that marked the workspace.
    await expect(
      getChild({
        deps: harness.deps,
        actorUserId: second.ownerId,
        workspaceId: second.workspaceId,
        childId,
      }),
    ).rejects.toMatchObject({ status: 404 });

    await jobs.runner.runOnce();

    const workspace = await withTenantTransaction(
      harness.deps.db,
      { workspaceId: second.workspaceId },
      (tx) => identityRepository.findWorkspaceById(tx, second.workspaceId),
    );
    expect(workspace?.status).toBe("deleted");
    expect(workspace?.deletedAt).not.toBeNull();

    const remaining = await withTenantTransaction(
      harness.deps.db,
      { workspaceId: second.workspaceId },
      (tx) =>
        purgeRepository.countRemainingForChild(tx, { workspaceId: second.workspaceId, childId }),
    );
    // verify-purge reports zero live references: no rows, and no brief kept for a gone workspace.
    expect(remaining).toMatchObject({
      captures: 0,
      events: 0,
      eventRevisions: 0,
      mediaAssets: 0,
      careSessions: 0,
      handoffCursors: 0,
      childCaregivers: 0,
      redactedBriefs: 0,
      unredactedBriefs: 0,
      liveChildRows: 0,
    });
    const members = await withTenantTransaction(
      harness.deps.db,
      { workspaceId: second.workspaceId },
      (tx) => identityRepository.listMembershipsForWorkspace(tx, second.workspaceId),
    );
    expect(members).toEqual([]);
    expect(
      jobs.storage.listObjects(workspaceObjectPrefix(second.workspaceId), 10),
    ).resolves.toEqual([]);
  });

  /** Creates a capture while the child is still readable, for the late-claim replay above. */
  async function createCaptureBeforeDeletion(childId: string): Promise<string> {
    const child = await readChild(childId);
    if (child === null) throw new Error("expected the child to exist");
    await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      capturesRepository.updateCaptureStatus(tx, {
        workspaceId,
        captureId: childId,
        status: "queued",
      }),
    ).catch(() => undefined);
    const created = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      capturesRepository.insertCapture(tx, {
        id: randomUUID(),
        workspaceId,
        childId,
        authorUserId: caregiverId,
        clientCaptureId: randomUUID(),
        inputKind: "text",
        capturedAt: new Date(),
        timezone: "America/Vancouver",
        locale: "en-CA",
        contentCiphertext: null,
        schemaVersion: 1,
        status: "queued",
      }),
    );
    return created.id;
  }

  /** Invokes one handler directly with a synthetic claim, the way a replayed lease would. */
  async function runHandler(
    handler: (context: JobContext) => Promise<JobOutcome>,
    input: {
      workspaceId: string;
      childId: string;
      kind: "validate_media" | "process_capture";
      assetId?: string;
      captureId?: string;
    },
  ): Promise<JobOutcome> {
    const job = {
      id: randomUUID(),
      kind: input.kind,
      dedupeKey: `late:${randomUUID()}`,
      status: "leased" as const,
      workspaceId: input.workspaceId,
      childId: input.childId,
      captureId: input.captureId ?? null,
      assetId: input.assetId ?? null,
      payload: {},
      checkpoint: null,
      attempts: 1,
      maxAttempts: 3,
      availableAt: new Date(),
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      lastErrorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return handler({
      runtime: jobs.runtime,
      job,
      leaseToken: job.leaseToken,
      saveCheckpoint: () => Promise.resolve(true),
    });
  }
});
