// What happens when the worker, the providers, or the caller's access fails part-way through.
// Every case here is one of the enumerated failures in the milestone 3 acceptance gate: a crash
// between stages, an exhausted retry budget, a revoked author, and a key that will not decrypt.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as jobsRepository from "../../packages/db/src/repositories/jobs";
import * as mediaRepository from "../../packages/db/src/repositories/media";
import {
  withJobTransaction,
  withTenantTransaction,
} from "../../packages/db/src/tenant-transaction";
import { scheduleReconciliation } from "../../packages/server/src/jobs/reconcile-clerk";
import { ProviderError } from "../../packages/server/src/lib/provider-error";
import { createCapture, getCapture } from "../../packages/server/src/services/captures";
import { getEvent } from "../../packages/server/src/services/events";
import { processCaptureDedupeKey } from "../../packages/server/src/services/job-keys";
import { completeAssetUpload, createAssetUpload } from "../../packages/server/src/services/media";
import { revokeMember } from "../../packages/server/src/services/memberships";
import { completeUpload, retryCapture } from "../../packages/server/src/services/uploads";
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
import type { CaptureDto } from "../../packages/contracts/src/index";
import type { JobRow } from "../../packages/db/src/types/jobs";
import type { JobHarness } from "./support/job-harness";
import type { TestHarness } from "./support/service-harness";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping worker recovery tests. ${missingDatabaseUrlMessage}`);

const TRANSCRIPT = "Fed 90 ml at two am, and first word Dada.";
const MINUTE_MS = 60_000;

describeIntegration("worker recovery", () => {
  let harness: TestHarness;
  let jobs: JobHarness;
  let workspaceId: string;
  let clerkOrgId: string;
  let ownerId: string;
  let childId: string;
  let now: Date;

  beforeAll(async () => {
    harness = await createHarness();
    jobs = createJobHarness(harness);
    const workspace = await seedWorkspace(harness, { label: "recovery" });
    workspaceId = workspace.workspaceId;
    clerkOrgId = workspace.clerkOrgId;
    ownerId = workspace.ownerId;
    childId = await seedChild(harness, { workspaceId, ownerId, name: "Rowan" });
  }, 90_000);

  afterAll(async () => {
    await jobs?.close();
    await harness?.close();
  });

  beforeEach(() => {
    // Ahead of the database clock, which is what stamps a new job's availability.
    now = new Date(Date.now() + MINUTE_MS);
    harness.setNow(now);
    jobs.transcription.failWith(null);
    jobs.extraction.failWith(null);
    jobs.storage.failReadsWith = null;
    jobs.transcription.state.calls = 0;
  });

  /** Moves the service clock so a job whose retry was scheduled with backoff becomes claimable. */
  function advance(ms: number): void {
    now = new Date(now.getTime() + ms);
    harness.setNow(now);
  }

  /** Creates an audio capture, stores its object, and completes the upload: a queued recording. */
  async function queueRecording(
    transcript = TRANSCRIPT,
    actorUserId = ownerId,
  ): Promise<CaptureDto> {
    const created = await createCapture({
      deps: harness.deps,
      actorUserId,
      input: {
        childId,
        clientCaptureId: randomUUID(),
        inputKind: "audio",
        capturedAt: now.toISOString(),
        timezone: "America/Vancouver",
        locale: "en-CA",
        audio: {
          declaredMime: "audio/m4a",
          declaredSizeBytes: Buffer.byteLength(transcript),
          declaredDurationMs: 5_000,
        },
      },
    });
    const assets = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      mediaRepository.listAssetsForCapture(tx, { workspaceId, childId, captureId: created.id }),
    );
    const asset = assets[0];
    if (asset === undefined) throw new Error("expected an allocated audio asset");
    // The fake provider transcribes the stored bytes, so the object is the transcript.
    jobs.storage.put(asset.objectKey, Buffer.from(transcript, "utf8"));
    const completed = await completeUpload({
      deps: harness.deps,
      actorUserId,
      captureId: created.id,
      input: { sizeBytes: Buffer.byteLength(transcript) },
    });
    return completed.capture;
  }

  function read(captureId: string, actorUserId = ownerId): Promise<CaptureDto> {
    return getCapture({ deps: harness.deps, actorUserId, captureId });
  }

  async function readAuditActions(entityId: string): Promise<string[]> {
    const rows = await harness.admin.db.execute<{ action: string }>(
      sql`select action from handoff.audit_log where entity_id = ${entityId}`,
    );
    return [...rows].map((row) => row.action);
  }

  function readJob(captureId: string): Promise<JobRow | null> {
    return withJobTransaction(jobs.dispatcher.db, (tx) =>
      jobsRepository.findJobByDedupeKey(tx, processCaptureDedupeKey(captureId)),
    );
  }

  it("keeps the transcript when a later stage crashes and does not transcribe again", async () => {
    const capture = await queueRecording();
    jobs.extraction.failOnce(new Error("worker crashed before it could commit"));

    await jobs.runner.runOnce();
    const afterCrash = await read(capture.id);
    // Still being worked on: a caregiver sees a failure only once the retries are spent.
    expect(afterCrash.status).toBe("processing");
    expect(afterCrash.draft?.rawTranscript).toBe(TRANSCRIPT);
    expect(afterCrash.draft?.candidates).toEqual([]);

    const crashed = await readJob(capture.id);
    expect(crashed?.status).toBe("queued");
    expect(crashed?.attempts).toBe(1);
    expect(crashed?.checkpoint).toEqual({ stage: "transcribed" });
    // The checkpoint records the stage and nothing else.
    expect(JSON.stringify(crashed?.checkpoint)).not.toContain("Fed");

    advance(MINUTE_MS);
    await jobs.runner.runOnce();

    const finished = await read(capture.id);
    expect(finished.status).toBe("needs_review");
    expect(finished.draft?.candidates.length).toBeGreaterThan(0);
    expect(jobs.transcription.state.calls).toBe(1);
  });

  it("re-extracts after a crash before the draft commit and leaves exactly one draft", async () => {
    const capture = await queueRecording();
    const extractionsBefore = jobs.extraction.calls.length;
    jobs.extraction.failOnce(new Error("worker crashed before it could commit"));

    await jobs.runner.runOnce();
    advance(MINUTE_MS);
    await jobs.runner.runOnce();

    const finished = await read(capture.id);
    expect(finished.status).toBe("needs_review");
    // The model ran twice because nothing was committed the first time; the draft exists once.
    expect(jobs.extraction.calls.length - extractionsBefore).toBe(2);
    expect(finished.draft?.candidates).toHaveLength(2);
    const ids = new Set(finished.draft?.candidates.map((candidate) => candidate.id));
    expect(ids.size).toBe(2);
    // One transcript write plus one draft write: the crashed attempt committed nothing.
    expect(finished.draftVersion).toBe(2);
  });

  it("reclaims an expired lease and ignores writes carrying the superseded token", async () => {
    const capture = await queueRecording();
    // A worker that took the job and died: the lease is already past its expiry.
    const staleToken = randomUUID();
    const stolen = await withJobTransaction(jobs.dispatcher.db, (tx) =>
      jobsRepository.claimNextJob(tx, {
        kinds: ["process_capture"],
        now,
        leaseMs: -1_000,
        leaseToken: staleToken,
      }),
    );
    expect(stolen?.leaseToken).toBe(staleToken);

    await jobs.runner.runOnce();
    const finished = await read(capture.id);
    expect(finished.status).toBe("needs_review");

    const stale = await withJobTransaction(jobs.dispatcher.db, async (tx) => ({
      completed: await jobsRepository.completeJob(tx, {
        jobId: stolen?.id ?? "",
        leaseToken: staleToken,
      }),
      checkpointed: await jobsRepository.saveJobCheckpoint(tx, {
        jobId: stolen?.id ?? "",
        leaseToken: staleToken,
        checkpoint: { stage: "transcribed" },
      }),
    }));
    expect(stale.completed).toBeNull();
    expect(stale.checkpointed).toBe(false);
    expect((await readJob(capture.id))?.status).toBe("succeeded");
  });

  it("retries a rate-limited provider with backoff and then fails the capture visibly", async () => {
    const capture = await queueRecording();
    jobs.transcription.failWith(
      new ProviderError({
        provider: "deepgram",
        code: "rate_limited",
        retryable: true,
        retryAfterMs: 5_000,
      }),
    );

    await jobs.runner.runOnce();
    const first = await readJob(capture.id);
    expect(first?.status).toBe("queued");
    // Backoff honours the provider's own Retry-After rather than retrying immediately.
    expect((first?.availableAt.getTime() ?? 0) - now.getTime()).toBeGreaterThanOrEqual(5_000);
    expect((await read(capture.id)).status).toBe("processing");

    advance(MINUTE_MS);
    await jobs.runner.runOnce();
    advance(MINUTE_MS);
    await jobs.runner.runOnce();

    const exhausted = await readJob(capture.id);
    expect(exhausted?.status).toBe("failed");
    expect(exhausted?.attempts).toBe(3);
    expect(exhausted?.lastErrorCode).toBe("provider_quota");

    const failed = await read(capture.id);
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("provider_quota");
    expect(failed.confirmedAt).toBeNull();
    expect(jobs.transcription.state.calls).toBe(3);
  });

  it("reports an unavailable transcription provider as a transcription failure", async () => {
    const capture = await queueRecording();
    jobs.transcription.failWith(
      new ProviderError({ provider: "deepgram", code: "unauthorized", retryable: false }),
    );

    await jobs.runner.runOnce();
    const failed = await read(capture.id);
    // A permission error is terminal: one attempt, not three.
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("transcription_failed");
    expect((await readJob(capture.id))?.attempts).toBe(1);
  });

  it("requeues a failed capture on request and reuses the transcript it already has", async () => {
    const capture = await queueRecording();
    jobs.extraction.failWith(
      new ProviderError({ provider: "anthropic", code: "invalid_input", retryable: false }),
    );
    await jobs.runner.runOnce();

    const failed = await read(capture.id);
    expect(failed.status).toBe("failed");
    expect(failed.errorCode).toBe("extraction_failed");
    const transcriptionCalls = jobs.transcription.state.calls;

    jobs.extraction.failWith(null);
    const requeued = await retryCapture({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId: capture.id,
    });
    expect(requeued.status).toBe("queued");
    const job = await readJob(capture.id);
    expect(job?.status).toBe("queued");
    expect(job?.attempts).toBe(0);

    await jobs.runner.runOnce();
    const finished = await read(capture.id);
    expect(finished.status).toBe("needs_review");
    expect(finished.draft?.candidates.length).toBeGreaterThan(0);
    // The retry reused the checkpointed transcript instead of paying for it again.
    expect(jobs.transcription.state.calls).toBe(transcriptionCalls);
  });

  it("cancels the work when the author's access is revoked before the draft is committed", async () => {
    const memberId = await seedUser(harness, {
      label: `revoked_${randomUUID().slice(0, 8)}`,
      clerkOrgId,
      role: "member",
    });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [{ userId: memberId, relationship: "caregiver", permission: "contributor" }],
    });
    const capture = await queueRecording(TRANSCRIPT, memberId);

    await revokeMember({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      targetUserId: memberId,
    });
    await jobs.runner.runOnce();

    const owned = await read(capture.id, ownerId);
    expect(owned.status).toBe("cancelled");
    expect(owned.draft?.candidates).toEqual([]);
    expect((await readJob(capture.id))?.lastErrorCode).toBe("cancelled");
  });

  it("reconciles a Clerk call that failed after the local revocation committed", async () => {
    const memberId = await seedUser(harness, {
      label: `reconcile_${randomUUID().slice(0, 8)}`,
      clerkOrgId,
      role: "member",
    });
    // The provider is unreachable, so local access stops and only the pending call is recorded.
    harness.clerk.failOperation("removeOrganizationMember");
    await revokeMember({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      targetUserId: memberId,
    });
    harness.clerk.clearFailures();

    const scheduled = await scheduleReconciliation({
      db: harness.deps.db,
      jobsDb: jobs.dispatcher.db,
    });
    expect(scheduled).toBeGreaterThanOrEqual(1);

    const callsBefore = harness.clerk.callsTo("removeOrganizationMember").length;
    await jobs.runner.runOnce();
    expect(harness.clerk.callsTo("removeOrganizationMember").length).toBe(callsBefore + 1);

    const actions = await readAuditActions(memberId);
    expect(actions).toContain("membership.clerk_removal_pending");
    expect(actions).toContain("membership.clerk_removal_reconciled");
  });

  it("re-normalizes a photo after a crash between writing the object and publishing it", async () => {
    const lines = [candidate({ kind: "milestone" })];
    const confirmed = await confirmManualCapture(harness, {
      actorUserId: ownerId,
      childId,
      candidates: lines,
    });
    const captureId = confirmed.capture.id;
    const eventId = confirmed.events[0]?.id ?? "";

    const photo = await jpegImage({ width: 900, height: 600 });
    const created = await createAssetUpload({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId,
      input: {
        kind: "image",
        declaredMime: "image/jpeg",
        declaredSizeBytes: photo.bytes.byteLength,
      },
    });
    const rawKey =
      (
        await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
          mediaRepository.findMediaAssetInWorkspace(tx, workspaceId, created.asset.id),
        )
      )?.objectKey ?? "";
    jobs.storage.put(rawKey, photo.bytes, "image/jpeg");
    await completeAssetUpload({
      deps: harness.deps,
      actorUserId: ownerId,
      assetId: created.asset.id,
      input: { sizeBytes: photo.bytes.byteLength },
    });

    // The worker wrote the normalized object and died before its ready transaction committed.
    const realPutObject = jobs.storage.putObject.bind(jobs.storage);
    jobs.storage.putObject = async (objectKey, bytes, contentType) => {
      await realPutObject(objectKey, bytes, contentType);
      throw new Error("worker crashed after writing the normalized object");
    };
    await jobs.runner.runOnce();
    jobs.storage.putObject = realPutObject;

    const crashed = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      mediaRepository.findMediaAssetInWorkspace(tx, workspaceId, created.asset.id),
    );
    expect(crashed?.status).toBe("uploaded");
    expect(crashed?.objectKey).toBe(rawKey);
    // The raw upload is still there, which is the only reason the retry can re-read the bytes.
    expect(jobs.storage.has(rawKey)).toBe(true);

    advance(MINUTE_MS);
    await jobs.runner.runOnce();

    const published = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      mediaRepository.findMediaAssetInWorkspace(tx, workspaceId, created.asset.id),
    );
    expect(published?.status).toBe("ready");
    expect(published?.objectKey).not.toBe(rawKey);
    // One object, not two: the retry replaced its own half-finished write and removed the raw file.
    expect(jobs.storage.has(rawKey)).toBe(false);
    expect(jobs.storage.has(published?.objectKey ?? "")).toBe(true);

    const revisions = await harness.admin.db.execute<{ operation: string }>(
      sql`select operation from handoff.event_revisions where event_id = ${eventId} order by journal_seq`,
    );
    expect([...revisions].map((row) => row.operation)).toEqual(["created", "media_updated"]);
    const event = await getEvent({ deps: harness.deps, actorUserId: ownerId, eventId });
    expect(event.readyAssetIds).toEqual([created.asset.id]);
  });

  it("fails closed on a decryption failure and never writes a plaintext fallback", async () => {
    const capture = await queueRecording();
    // Same shape, wrong authentication tag: the envelope no longer authenticates.
    await harness.admin.db.execute(sql`
      update handoff.captures
      set content_ciphertext = jsonb_set(content_ciphertext, '{tag}', '"AAAAAAAAAAAAAAAAAAAAAA=="')
      where id = ${capture.id}
    `);

    await jobs.runner.runOnce();
    const job = await readJob(capture.id);
    expect(job?.status).toBe("failed");
    expect(job?.lastErrorCode).toBe("crypto_failure");

    const row = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      tx.execute(
        sql`select status, error_code, content_ciphertext from handoff.captures where id = ${capture.id}`,
      ),
    );
    const stored = JSON.stringify(row);
    expect(stored).toContain("crypto_failure");
    expect(stored).not.toContain(TRANSCRIPT);
    expect(jobs.transcription.state.calls).toBe(0);
  });
});
