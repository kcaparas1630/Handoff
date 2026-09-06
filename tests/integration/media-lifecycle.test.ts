// Every enumerated failure in the milestone 4 acceptance gate, end to end: MIME spoof, excessive
// size and duration, path tampering, overwrite attempt, missing upload, unsupported container,
// quota race, duplicate completion, expired authorization, and orphan object. Then the publishing
// rules: what a normalized photo contains, what a rejected upload never reaches, and how an
// attachment added after a handoff appears in the next one.
//
// Real Postgres, real encryption, real sharp and file-type inspection. Only the object store is a
// fake, and it behaves like the provider: no upsert, and a missing object is a missing object.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAssetUploadRequestSchema,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_DURATION_MS,
} from "../../packages/contracts/src/index";
import * as jobsRepository from "../../packages/db/src/repositories/jobs";
import * as mediaRepository from "../../packages/db/src/repositories/media";
import * as storageQuotaRepository from "../../packages/db/src/repositories/storage-quota";
import {
  withJobTransaction,
  withTenantTransaction,
} from "../../packages/db/src/tenant-transaction";
import { cleanupUploads } from "../../packages/server/src/jobs/cleanup-uploads";
import { validateMedia } from "../../packages/server/src/jobs/validate-media";
import { NORMALIZED_MAX_EDGE } from "../../packages/server/src/media/normalize-image";
import { confirmCapture } from "../../packages/server/src/services/capture-confirmation";
import { createCapture } from "../../packages/server/src/services/captures";
import { getEvent } from "../../packages/server/src/services/events";
import { acknowledgeBrief } from "../../packages/server/src/services/handoff-acknowledgement";
import { createBrief } from "../../packages/server/src/services/handoffs";
import { revokeMember } from "../../packages/server/src/services/memberships";
import {
  cleanupUploadsDedupeKey,
  validateMediaDedupeKey,
} from "../../packages/server/src/services/job-keys";
import { completeAssetUpload, createAssetUpload } from "../../packages/server/src/services/media";
import { createJobHarness } from "./support/job-harness";
import { candidate } from "./support/journal-fixtures";
import { jpegImage, mp4Video, pngImage, unrecognizedBytes } from "./support/media-fixtures";
import {
  createHarness,
  grantChild,
  seedChild,
  seedUser,
  seedWorkspace,
} from "./support/service-harness";
import { missingDatabaseUrlMessage } from "./support/test-database";
import type { CreateAssetUploadRequest } from "../../packages/contracts/src/index";
import type { MediaAssetRow } from "../../packages/db/src/types/media";
import type { JobContext } from "../../packages/server/src/types/jobs";
import type { JobHarness } from "./support/job-harness";
import type { TestHarness } from "./support/service-harness";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping media lifecycle tests. ${missingDatabaseUrlMessage}`);

const CHILD_NAME = "Marker-Child-Media";
const BUDGET_BYTES = 50_000_000;

describeIntegration("media lifecycle", () => {
  let harness: TestHarness;
  let jobs: JobHarness;
  let workspaceId: string;
  let clerkOrgId: string;
  let ownerId: string;
  let authorId: string;
  let recipientId: string;
  let childId: string;

  beforeAll(async () => {
    harness = await createHarness();
    jobs = createJobHarness(harness);
    const workspace = await seedWorkspace(harness, { label: "medialife" });
    workspaceId = workspace.workspaceId;
    clerkOrgId = workspace.clerkOrgId;
    ownerId = workspace.ownerId;
    childId = await seedChild(harness, { workspaceId, ownerId, name: CHILD_NAME });
    authorId = await seedUser(harness, {
      label: "ml_author",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
    });
    recipientId = await seedUser(harness, {
      label: "ml_recipient",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
    });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [
        { userId: authorId, relationship: "caregiver", permission: "contributor" },
        { userId: recipientId, relationship: "caregiver", permission: "contributor" },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await jobs?.close();
    await harness?.close();
  });

  beforeEach(async () => {
    await setBudget(BUDGET_BYTES);
    jobs.storage.readUrls.length = 0;
    jobs.storage.written.length = 0;
    jobs.storage.deleted.length = 0;
  });

  async function setBudget(bytes: number): Promise<void> {
    await harness.admin.db.execute(sql`
      update handoff.workspaces
      set storage_budget_bytes = ${bytes}, storage_reserved_bytes = 0, storage_used_bytes = 0
      where id = ${workspaceId}
    `);
  }

  function readStorage() {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      storageQuotaRepository.findWorkspaceStorage(tx, workspaceId),
    );
  }

  function readAsset(assetId: string) {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      mediaRepository.findMediaAssetInWorkspace(tx, workspaceId, assetId),
    );
  }

  function readValidateJob(assetId: string) {
    return withJobTransaction(jobs.dispatcher.db, (tx) =>
      jobsRepository.findJobByDedupeKey(tx, validateMediaDedupeKey(assetId)),
    );
  }

  /** A manual capture with the given reviewed lines, left unconfirmed. */
  async function manualCapture(candidates = [candidate()]): Promise<string> {
    const created = await createCapture({
      deps: harness.deps,
      actorUserId: authorId,
      input: {
        childId,
        clientCaptureId: randomUUID(),
        inputKind: "manual",
        capturedAt: new Date().toISOString(),
        timezone: "America/Vancouver",
        locale: "en-CA",
        candidates,
      },
    });
    return created.id;
  }

  function allocate(captureId: string, input: CreateAssetUploadRequest) {
    return createAssetUpload({ deps: harness.deps, actorUserId: authorId, captureId, input });
  }

  function imageRequest(sizeBytes: number, declaredMime = "image/jpeg"): CreateAssetUploadRequest {
    return { kind: "image", declaredMime, declaredSizeBytes: sizeBytes };
  }

  function videoRequest(sizeBytes: number, durationMs = 8_000): CreateAssetUploadRequest {
    return {
      kind: "video",
      declaredMime: "video/mp4",
      declaredSizeBytes: sizeBytes,
      declaredDurationMs: durationMs,
    };
  }

  /** Allocate, store the bytes at the server's own key, and report the upload as finished. */
  async function upload(
    captureId: string,
    request: CreateAssetUploadRequest,
    bytes: Buffer,
  ): Promise<MediaAssetRow> {
    const created = await allocate(captureId, request);
    const asset = await readAsset(created.asset.id);
    if (asset === null) throw new Error("expected an allocated asset");
    jobs.storage.put(asset.objectKey, bytes, request.declaredMime);
    await completeAssetUpload({
      deps: harness.deps,
      actorUserId: authorId,
      assetId: asset.id,
      input: { sizeBytes: bytes.byteLength },
    });
    return asset;
  }

  /** Drives one job handler directly, which is how a replay is reproduced deterministically. */
  async function runHandler(handler: typeof validateMedia, dedupeKey: string): Promise<void> {
    const job = await withJobTransaction(jobs.dispatcher.db, (tx) =>
      jobsRepository.findJobByDedupeKey(tx, dedupeKey),
    );
    if (job === null) throw new Error(`expected a queued job for ${dedupeKey}`);
    const context: JobContext = {
      runtime: jobs.runtime,
      job,
      leaseToken: randomUUID(),
      saveCheckpoint: () => Promise.resolve(true),
    };
    const outcome = await handler(context);
    expect(outcome.status).toBe("completed");
  }

  it("rejects a photo whose bytes are not what it declared, and gives back its bytes", async () => {
    const captureId = await manualCapture();
    const png = await pngImage();
    const before = await readStorage();
    // Declared as a JPEG, actually a PNG: the allowlist accepts both, the spoof is the mismatch.
    const asset = await upload(captureId, imageRequest(png.bytes.byteLength), png.bytes);
    expect((await readStorage())?.reservedBytes).toBe(
      (before?.reservedBytes ?? 0) + png.bytes.byteLength,
    );

    await jobs.runner.runOnce();

    const rejected = await readAsset(asset.id);
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.verifiedMime).toBeNull();
    expect(jobs.storage.has(asset.objectKey)).toBe(false);
    const after = await readStorage();
    expect(after?.reservedBytes).toBe(before?.reservedBytes);
    expect(after?.usedBytes).toBe(before?.usedBytes);
  });

  it("refuses an oversize photo at allocation and an oversize object at completion", async () => {
    const captureId = await manualCapture();
    await expect(allocate(captureId, imageRequest(IMAGE_MAX_BYTES + 1))).rejects.toMatchObject({
      status: 422,
      fieldErrors: { declaredSizeBytes: ["A photo may be at most 5 MB"] },
    });

    // Declared honestly, then more bytes than that were stored.
    const photo = await jpegImage({ width: 200, height: 200 });
    const created = await allocate(captureId, imageRequest(photo.bytes.byteLength));
    const asset = await readAsset(created.asset.id);
    jobs.storage.put(asset?.objectKey ?? "", Buffer.concat([photo.bytes, Buffer.alloc(64)]));
    await expect(
      completeAssetUpload({
        deps: harness.deps,
        actorUserId: authorId,
        assetId: created.asset.id,
        input: { sizeBytes: photo.bytes.byteLength },
      }),
    ).rejects.toMatchObject({ status: 422, code: "validation_failed" });
    expect((await readAsset(created.asset.id))?.status).toBe("pending_upload");
    expect(await readValidateJob(created.asset.id)).toBeNull();
  });

  it("rejects a clip longer than the product limit, whatever it declared", async () => {
    const captureId = await manualCapture();
    const longClip = mp4Video({ durationMs: VIDEO_MAX_DURATION_MS + 1_000 });
    const asset = await upload(captureId, videoRequest(longClip.byteLength, 8_000), longClip);

    await jobs.runner.runOnce();
    expect((await readAsset(asset.id))?.status).toBe("rejected");
    expect(jobs.storage.has(asset.objectKey)).toBe(false);
  });

  it("gives a client no way to name a storage path", async () => {
    // The request contract carries a kind, a MIME type, a size, and a duration. There is no
    // object key, bucket, or URL field to supply, and an extra one is not carried through.
    const parsed = createAssetUploadRequestSchema.parse({
      kind: "image",
      declaredMime: "image/jpeg",
      declaredSizeBytes: 1_024,
      objectKey: "../other-tenant/secret.jpg",
      bucket: "someone-elses",
    });
    expect(Object.keys(parsed).sort()).toEqual(["declaredMime", "declaredSizeBytes", "kind"]);

    const captureId = await manualCapture();
    const created = await allocate(captureId, imageRequest(1_024));
    const asset = await readAsset(created.asset.id);
    // Server-generated: workspace, child, capture, asset, and an extension from the MIME map.
    expect(asset?.objectKey).toBe(`${workspaceId}/${childId}/${captureId}/${created.asset.id}.jpg`);
  });

  it("re-signs the same key without upsert rather than letting a second PUT overwrite", async () => {
    const captureId = await manualCapture();
    const photo = await jpegImage({ width: 120, height: 120 });
    const created = await allocate(captureId, imageRequest(photo.bytes.byteLength));
    const asset = await readAsset(created.asset.id);
    const objectKey = asset?.objectKey ?? "";
    expect(created.upload.headers["x-upsert"]).toBe("false");

    // A re-signed authorization covers the same allocated object, and is a fresh signature
    // rather than the stored one: nothing about the first is kept.
    const resigned = await jobs.storage.createUploadAuthorization({
      objectKey,
      contentType: "image/jpeg",
      maxBytes: IMAGE_MAX_BYTES,
      expiresInSeconds: 900,
    });
    expect(resigned.headers["x-upsert"]).toBe("false");
    expect(resigned.url).toContain(encodeURIComponent(objectKey));

    jobs.storage.put(objectKey, photo.bytes, "image/jpeg");
    // The second PUT is what the header forbids, and the provider is what enforces it.
    expect(() => {
      jobs.storage.put(objectKey, Buffer.alloc(8), "image/jpeg");
    }).toThrow();
    expect(jobs.storage.read(objectKey)?.byteLength).toBe(photo.bytes.byteLength);
  });

  it("refuses a completion when nothing was ever stored", async () => {
    const captureId = await manualCapture();
    const created = await allocate(captureId, imageRequest(2_048));
    await expect(
      completeAssetUpload({
        deps: harness.deps,
        actorUserId: authorId,
        assetId: created.asset.id,
        input: { sizeBytes: 2_048 },
      }),
    ).rejects.toMatchObject({ status: 422, code: "validation_failed" });

    expect((await readAsset(created.asset.id))?.status).toBe("pending_upload");
    expect(await readValidateJob(created.asset.id)).toBeNull();
  });

  it("rejects bytes that are not the container they claimed to be", async () => {
    const captureId = await manualCapture();
    const notAVideo = unrecognizedBytes(1_024);
    const asset = await upload(captureId, videoRequest(notAVideo.byteLength), notAVideo);

    await jobs.runner.runOnce();
    const rejected = await readAsset(asset.id);
    expect(rejected?.status).toBe("rejected");
    // The whole point of container inspection: the declared type was accepted by the schema.
    expect(rejected?.declaredMime).toBe("video/mp4");
    expect(jobs.storage.has(asset.objectKey)).toBe(false);
  });

  it("lets exactly one of two concurrent allocations spend the last of the budget", async () => {
    const captureId = await manualCapture();
    const size = 400_000;
    // Room for one of the two, so the loser must see the winner's reservation.
    await setBudget(size + size / 2);

    const results = await Promise.allSettled([
      allocate(captureId, imageRequest(size)),
      allocate(captureId, imageRequest(size)),
    ]);
    const created = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result) => result.status === "rejected");
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.status === "rejected" ? refused[0].reason : null).toMatchObject({
      status: 422,
      fieldErrors: { storage: ["Workspace storage budget exceeded"] },
    });
    expect((await readStorage())?.reservedBytes).toBe(size);
  });

  it("queues one validation for a repeated completion and returns the same asset", async () => {
    const captureId = await manualCapture();
    const photo = await jpegImage({ width: 100, height: 100 });
    const asset = await upload(captureId, imageRequest(photo.bytes.byteLength), photo.bytes);

    const job = await readValidateJob(asset.id);
    expect(job?.kind).toBe("validate_media");
    expect(job?.payload).toEqual({ assetId: asset.id });

    const again = await completeAssetUpload({
      deps: harness.deps,
      actorUserId: authorId,
      assetId: asset.id,
      input: { sizeBytes: photo.bytes.byteLength },
    });
    expect(again.id).toBe(asset.id);
    expect(again.status).toBe("uploaded");
    const afterReplay = await readValidateJob(asset.id);
    expect(afterReplay?.id).toBe(job?.id);
    expect(afterReplay?.attempts).toBe(0);
  });

  it("purges an expired allocation once, however many times the sweep runs", async () => {
    const captureId = await manualCapture();
    const created = await allocate(captureId, imageRequest(3_000));
    const asset = await readAsset(created.asset.id);
    jobs.storage.put(asset?.objectKey ?? "", Buffer.alloc(3_000, 4), "image/jpeg");
    const reservedBefore = (await readStorage())?.reservedBytes ?? 0;

    await harness.admin.db.execute(
      sql`update handoff.media_assets set expires_at = now() - interval '1 hour' where id = ${created.asset.id}`,
    );

    const dedupeKey = cleanupUploadsDedupeKey(workspaceId, nextDayOf(harness.deps.now()));
    await runHandler(cleanupUploads, dedupeKey);
    const purged = await readAsset(created.asset.id);
    expect(purged?.status).toBe("deleted");
    expect(purged?.cleanupState).toBe("quota_released");
    expect(jobs.storage.has(asset?.objectKey ?? "")).toBe(false);
    const afterFirst = await readStorage();
    expect(afterFirst?.reservedBytes).toBe(reservedBefore - 3_000);

    // The interrupted-and-repeated case: the counter must not move a second time.
    await runHandler(cleanupUploads, dedupeKey);
    expect((await readStorage())?.reservedBytes).toBe(afterFirst?.reservedBytes);
  });

  it("removes an object no asset row claims and keeps the ones that are claimed", async () => {
    const captureId = await manualCapture();
    const photo = await jpegImage({ width: 100, height: 100 });
    const asset = await upload(captureId, imageRequest(photo.bytes.byteLength), photo.bytes);
    await jobs.runner.runOnce();
    const published = await readAsset(asset.id);
    expect(published?.status).toBe("ready");

    // An upload that finished at the provider but whose completion callback never arrived.
    const orphanKey = `${workspaceId}/${childId}/${captureId}/${randomUUID()}.jpg`;
    jobs.storage.put(orphanKey, Buffer.alloc(128, 9), "image/jpeg");

    await runHandler(
      cleanupUploads,
      cleanupUploadsDedupeKey(workspaceId, nextDayOf(harness.deps.now())),
    );

    expect(jobs.storage.has(orphanKey)).toBe(false);
    expect(jobs.storage.has(published?.objectKey ?? "")).toBe(true);
    expect((await readAsset(asset.id))?.status).toBe("ready");
  });

  it("publishes one media_updated revision per event, however often validation replays", async () => {
    const lines = [candidate(), candidate({ kind: "diaper" })];
    const captureId = await manualCapture(lines);
    const confirmed = await confirmCapture({
      deps: harness.deps,
      actorUserId: authorId,
      captureId,
      input: {
        expectedDraftVersion: 0,
        candidates: lines.map(({ sourceStart: _s, sourceEnd: _e, ...rest }) => rest),
      },
    });
    expect(confirmed.events).toHaveLength(2);
    for (const event of confirmed.events) expect(event.readyAssetIds).toEqual([]);

    const photo = await jpegImage({ width: 300, height: 200 });
    const asset = await upload(captureId, imageRequest(photo.bytes.byteLength), photo.bytes);
    await jobs.runner.runOnce();

    const afterFirst = await readRevisionCounts(confirmed.events.map((event) => event.id));
    expect(afterFirst).toEqual([2, 2]);
    for (const event of confirmed.events) {
      const reread = await getEvent({
        deps: harness.deps,
        actorUserId: authorId,
        eventId: event.id,
      });
      expect(reread.readyAssetIds).toEqual([asset.id]);
    }

    // The worker's response was lost and the job ran again. Every event already lists the asset,
    // so the replay appends nothing rather than looping on new revisions.
    await runHandler(validateMedia, validateMediaDedupeKey(asset.id));
    expect(await readRevisionCounts(confirmed.events.map((event) => event.id))).toEqual([2, 2]);
  });

  it("publishes a photo with no camera metadata and a bounded long edge", async () => {
    const captureId = await manualCapture();
    const original = await jpegImage({
      width: 3_000,
      height: 2_000,
      withLocationExif: true,
    });
    expect((await sharp(original.bytes).metadata()).exif).toBeDefined();

    const asset = await upload(captureId, imageRequest(original.bytes.byteLength), original.bytes);
    await jobs.runner.runOnce();

    const published = await readAsset(asset.id);
    expect(published?.status).toBe("ready");
    expect(published?.verifiedMime).toBe("image/jpeg");
    // Republished under a new key, and the raw camera file is gone.
    expect(published?.objectKey).not.toBe(asset.objectKey);
    expect(jobs.storage.has(asset.objectKey)).toBe(false);

    const stored = jobs.storage.read(published?.objectKey ?? "");
    expect(stored).not.toBeNull();
    const metadata = await sharp(stored ?? Buffer.alloc(0)).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(Math.max(metadata.width, metadata.height)).toBeLessThanOrEqual(NORMALIZED_MAX_EDGE);
    expect(metadata.format).toBe("jpeg");
    // The settled usage is the normalized size, not what the client declared.
    expect(published?.sizeBytes).toBe(stored?.byteLength);
    const storage = await readStorage();
    expect(storage?.reservedBytes).toBe(0);
    expect(storage?.usedBytes).toBe(stored?.byteLength);
  });

  it("discards an attachment whose uploader lost access before it was validated", async () => {
    const revokedId = await seedUser(harness, {
      label: `ml_revoked_${randomUUID().slice(0, 8)}`,
      clerkOrgId,
      role: "member",
    });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [{ userId: revokedId, relationship: "caregiver", permission: "contributor" }],
    });
    const created = await createCapture({
      deps: harness.deps,
      actorUserId: revokedId,
      input: {
        childId,
        clientCaptureId: randomUUID(),
        inputKind: "manual",
        capturedAt: new Date().toISOString(),
        timezone: "America/Vancouver",
        locale: "en-CA",
        candidates: [],
      },
    });
    const photo = await jpegImage({ width: 100, height: 100 });
    const allocated = await createAssetUpload({
      deps: harness.deps,
      actorUserId: revokedId,
      captureId: created.id,
      input: {
        kind: "image",
        declaredMime: "image/jpeg",
        declaredSizeBytes: photo.bytes.byteLength,
      },
    });
    const asset = await readAsset(allocated.asset.id);
    jobs.storage.put(asset?.objectKey ?? "", photo.bytes, "image/jpeg");
    await completeAssetUpload({
      deps: harness.deps,
      actorUserId: revokedId,
      assetId: allocated.asset.id,
      input: { sizeBytes: photo.bytes.byteLength },
    });

    await revokeMember({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      targetUserId: revokedId,
    });
    await jobs.runner.runOnce();

    const discarded = await readAsset(allocated.asset.id);
    expect(discarded?.status).toBe("rejected");
    expect(jobs.storage.has(asset?.objectKey ?? "")).toBe(false);
    expect((await readStorage())?.reservedBytes).toBe(0);
  });

  it("keeps an unvalidated or rejected upload out of every published event and brief", async () => {
    const lines = [candidate({ kind: "note" })];
    const captureId = await manualCapture(lines);
    const png = await pngImage();
    // One attachment still awaiting validation, one that will be rejected.
    await upload(captureId, imageRequest(png.bytes.byteLength), png.bytes);
    const pending = await allocate(
      captureId,
      videoRequest(mp4Video().byteLength, VIDEO_MAX_DURATION_MS),
    );

    const confirmed = await confirmCapture({
      deps: harness.deps,
      actorUserId: authorId,
      captureId,
      input: {
        expectedDraftVersion: 0,
        candidates: lines.map(({ sourceStart: _s, sourceEnd: _e, ...rest }) => rest),
      },
    });
    const eventId = confirmed.events[0]?.id ?? "";
    expect(confirmed.events[0]?.readyAssetIds).toEqual([]);

    await jobs.runner.runOnce();
    const reread = await getEvent({ deps: harness.deps, actorUserId: authorId, eventId });
    expect(reread.readyAssetIds).toEqual([]);

    const brief = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    const entries = [...brief.snapshot.updates, ...brief.snapshot.moments].filter(
      (entry) => entry.eventId === eventId,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.readyAssetIds).toEqual([]);
    // Neither the rejected upload nor the one still pending is named anywhere in the snapshot.
    expect(JSON.stringify(brief.snapshot)).not.toContain(pending.asset.id);
  });

  it("shows an attachment added after a handoff as an update in the next one", async () => {
    const lines = [candidate({ kind: "milestone" })];
    const captureId = await manualCapture(lines);
    const confirmed = await confirmCapture({
      deps: harness.deps,
      actorUserId: authorId,
      captureId,
      input: {
        expectedDraftVersion: 0,
        candidates: lines.map(({ sourceStart: _s, sourceEnd: _e, ...rest }) => rest),
      },
    });
    const eventId = confirmed.events[0]?.id ?? "";

    const first = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    expect(first.snapshot.moments.some((entry) => entry.eventId === eventId)).toBe(true);
    await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: first.id,
      input: { startCare: false },
    });

    const photo = await jpegImage({ width: 240, height: 180 });
    const asset = await upload(captureId, imageRequest(photo.bytes.byteLength), photo.bytes);
    await jobs.runner.runOnce();

    const next = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    const entry = [...next.snapshot.moments, ...next.snapshot.updates].find(
      (candidateEntry) => candidateEntry.eventId === eventId,
    );
    // `media_updated` is a published change, so it lands in the next brief, and the collapse rule
    // labels an entry that is not purely a creation as "updated".
    expect(entry?.label).toBe("updated");
    expect(entry?.readyAssetIds).toEqual([asset.id]);
  });

  it("names stored objects by id only, never by anything a caregiver typed", async () => {
    const rows = await harness.admin.db.execute<{ object_key: string }>(
      sql`select object_key from handoff.media_assets`,
    );
    const keys = [...rows].map((row) => row.object_key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain(CHILD_NAME);
      expect(key).toMatch(
        /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}(\.normalized)?\.[a-z0-9]+$/,
      );
    }
  });

  /** How many revisions each event has, in the order the ids were given. */
  async function readRevisionCounts(eventIds: readonly string[]): Promise<number[]> {
    const counts: number[] = [];
    for (const eventId of eventIds) {
      const rows = await harness.admin.db.execute<{ count: number }>(
        sql`select count(*)::int as count from handoff.event_revisions where event_id = ${eventId}`,
      );
      counts.push([...rows][0]?.count ?? 0);
    }
    return counts;
  }
});

function nextDayOf(now: Date): Date {
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
