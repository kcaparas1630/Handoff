// Allocating, verifying, and completing a recording upload. Real Postgres, real encryption, real
// quota arithmetic; only the object store is a fake, because the assertions are about what the
// server does with what the store reports.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUDIO_MAX_BYTES,
  AUDIO_MAX_DURATION_MS,
  createCaptureRequestSchema,
} from "../../packages/contracts/src/index";
import * as jobsRepository from "../../packages/db/src/repositories/jobs";
import * as mediaRepository from "../../packages/db/src/repositories/media";
import * as storageQuotaRepository from "../../packages/db/src/repositories/storage-quota";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { ApiHttpError } from "../../packages/server/src/http/errors";
import { createCapture, getCapture } from "../../packages/server/src/services/captures";
import { processCaptureDedupeKey } from "../../packages/server/src/services/job-keys";
import { completeUpload } from "../../packages/server/src/services/uploads";
import { createJobHarness } from "./support/job-harness";
import {
  createHarness,
  grantChild,
  seedChild,
  seedUser,
  seedWorkspace,
} from "./support/service-harness";
import { missingDatabaseUrlMessage } from "./support/test-database";
import type { CreateCaptureRequest } from "../../packages/contracts/src/index";
import type { JobHarness } from "./support/job-harness";
import type { TestHarness } from "./support/service-harness";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping audio upload tests. ${missingDatabaseUrlMessage}`);

const AUDIO_BYTES = 4_096;

describeIntegration("audio capture upload", () => {
  let harness: TestHarness;
  let jobs: JobHarness;
  let workspaceId: string;
  let ownerId: string;
  let memberId: string;
  let childId: string;

  beforeAll(async () => {
    harness = await createHarness();
    jobs = createJobHarness(harness);
    const workspace = await seedWorkspace(harness, { label: "audio" });
    workspaceId = workspace.workspaceId;
    ownerId = workspace.ownerId;
    childId = await seedChild(harness, {
      workspaceId,
      ownerId,
      name: "Rowan",
    });
    memberId = await seedUser(harness, {
      label: "audio_member",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
    });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [{ userId: memberId, relationship: "caregiver", permission: "contributor" }],
    });
  }, 90_000);

  afterAll(async () => {
    await jobs?.close();
    await harness?.close();
  });

  beforeEach(async () => {
    await setBudget(1_000_000);
  });

  /** The budget is workspace metadata with no service that edits it; the test sets it directly. */
  async function setBudget(bytes: number): Promise<void> {
    await harness.admin.db.execute(sql`
      update handoff.workspaces
      set storage_budget_bytes = ${bytes}, storage_reserved_bytes = 0, storage_used_bytes = 0
      where id = ${workspaceId}
    `);
  }

  function audioRequest(overrides: Partial<CreateCaptureRequest> = {}): CreateCaptureRequest {
    return createCaptureRequestSchema.parse({
      childId,
      clientCaptureId: randomUUID(),
      inputKind: "audio",
      capturedAt: new Date().toISOString(),
      timezone: "America/Vancouver",
      locale: "en-CA",
      audio: {
        declaredMime: "audio/m4a",
        declaredSizeBytes: AUDIO_BYTES,
        declaredDurationMs: 5_000,
      },
      ...overrides,
    });
  }

  function createAudioCapture(actorUserId = ownerId) {
    return createCapture({ deps: harness.deps, actorUserId, input: audioRequest() });
  }

  function readStorage() {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      storageQuotaRepository.findWorkspaceStorage(tx, workspaceId),
    );
  }

  function readAssets(captureId: string) {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      mediaRepository.listAssetsForCapture(tx, { workspaceId, childId, captureId }),
    );
  }

  function readJob(captureId: string) {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      jobsRepository.findJobByDedupeKey(tx, processCaptureDedupeKey(captureId)),
    );
  }

  /** Stands in for the client's direct PUT to the signed URL. */
  async function uploadObject(captureId: string, bytes = AUDIO_BYTES): Promise<void> {
    const [asset] = await readAssets(captureId);
    if (asset === undefined) throw new Error("expected an allocated audio asset");
    jobs.storage.put(asset.objectKey, Buffer.alloc(bytes, 1));
  }

  it("allocates a pending asset, reserves its bytes, and returns one upload authorization", async () => {
    const before = await readStorage();
    const capture = await createAudioCapture();

    expect(capture.status).toBe("awaiting_upload");
    expect(capture.audioAsset?.status).toBe("pending_upload");
    expect(capture.upload?.method).toBe("PUT");
    expect(capture.upload?.maxBytes).toBe(AUDIO_MAX_BYTES);
    expect(capture.upload?.headers["x-upsert"]).toBe("false");
    expect(new Date(capture.upload?.expiresAt ?? 0).getTime()).toBeGreaterThan(Date.now());

    const assets = await readAssets(capture.id);
    expect(assets).toHaveLength(1);
    // Server-generated key: workspace, child, capture, asset, and an extension from the MIME map.
    expect(assets[0]?.objectKey).toBe(
      `${workspaceId}/${childId}/${capture.id}/${assets[0]?.id ?? ""}.m4a`,
    );
    const after = await readStorage();
    expect((after?.reservedBytes ?? 0) - (before?.reservedBytes ?? 0)).toBe(AUDIO_BYTES);
    // No object exists yet, and nothing is queued until the upload is verified.
    expect(await readJob(capture.id)).toBeNull();
  });

  it("refuses an over-budget recording without allocating anything or calling the provider", async () => {
    await setBudget(1_024);
    const authorizedBefore = jobs.storage.authorized.length;
    const before = await readStorage();

    await expect(createAudioCapture()).rejects.toMatchObject({
      status: 422,
      code: "validation_failed",
      fieldErrors: { storage: ["Workspace storage budget exceeded"] },
    });

    const after = await readStorage();
    expect(after?.reservedBytes).toBe(before?.reservedBytes);
    expect(jobs.storage.authorized).toHaveLength(authorizedBefore);
  });

  it("refuses a recording that declares an unsupported format, size, or duration", () => {
    const base = {
      childId,
      clientCaptureId: randomUUID(),
      inputKind: "audio",
      capturedAt: new Date().toISOString(),
      timezone: "America/Vancouver",
      locale: "en-CA",
    };
    const declared = { declaredMime: "audio/m4a", declaredSizeBytes: 10, declaredDurationMs: 10 };

    expect(
      createCaptureRequestSchema.safeParse({
        ...base,
        audio: { ...declared, declaredMime: "audio/ogg" },
      }).success,
    ).toBe(false);
    expect(
      createCaptureRequestSchema.safeParse({
        ...base,
        audio: { ...declared, declaredSizeBytes: AUDIO_MAX_BYTES + 1 },
      }).success,
    ).toBe(false);
    expect(
      createCaptureRequestSchema.safeParse({
        ...base,
        audio: { ...declared, declaredDurationMs: AUDIO_MAX_DURATION_MS + 1 },
      }).success,
    ).toBe(false);
  });

  it("refuses a completion whose reported size does not match the stored object", async () => {
    const capture = await createAudioCapture();
    await uploadObject(capture.id, AUDIO_BYTES);

    await expect(
      completeUpload({
        deps: harness.deps,
        actorUserId: ownerId,
        captureId: capture.id,
        input: { sizeBytes: AUDIO_BYTES - 1 },
      }),
    ).rejects.toMatchObject({ status: 422, code: "validation_failed" });

    // The capture stays awaiting_upload so the client can PUT the file again.
    const reread = await getCapture({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId: capture.id,
    });
    expect(reread.status).toBe("awaiting_upload");
    expect(await readJob(capture.id)).toBeNull();
  });

  it("refuses a completion when the object was never stored", async () => {
    const capture = await createAudioCapture();
    await expect(
      completeUpload({
        deps: harness.deps,
        actorUserId: ownerId,
        captureId: capture.id,
        input: { sizeBytes: AUDIO_BYTES },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await readJob(capture.id)).toBeNull();
  });

  it("queues exactly one job on completion and repeats it idempotently", async () => {
    const capture = await createAudioCapture();
    await uploadObject(capture.id);

    const completed = await completeUpload({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId: capture.id,
      input: { sizeBytes: AUDIO_BYTES, durationMs: 4_200 },
    });
    expect(completed.capture.status).toBe("queued");
    expect(completed.asset.status).toBe("uploaded");
    expect(completed.asset.sizeBytes).toBe(AUDIO_BYTES);

    const job = await readJob(capture.id);
    expect(job?.kind).toBe("process_capture");
    expect(job?.status).toBe("queued");
    // The payload references the capture; no transcript or filename is copied into the queue.
    expect(job?.payload).toEqual({ captureId: capture.id });

    const again = await completeUpload({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId: capture.id,
      input: { sizeBytes: AUDIO_BYTES },
    });
    expect(again.capture.status).toBe("queued");
    expect(again.capture.id).toBe(capture.id);
    const afterReplay = await readJob(capture.id);
    expect(afterReplay?.id).toBe(job?.id);
    expect(afterReplay?.attempts).toBe(0);
  });

  it("hides another caregiver's recording from a non-author who tries to complete it", async () => {
    const capture = await createAudioCapture();
    await uploadObject(capture.id);

    await expect(
      completeUpload({
        deps: harness.deps,
        actorUserId: memberId,
        captureId: capture.id,
        input: { sizeBytes: AUDIO_BYTES },
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("re-signs an expired authorization for the author instead of replaying the old one", async () => {
    const capture = await createAudioCapture();
    const signedBefore = jobs.storage.authorized.length;

    const reread = await getCapture({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId: capture.id,
    });
    expect(reread.upload?.assetId).toBe(capture.audioAsset?.id);
    expect(reread.upload?.url).not.toBe("");
    expect(jobs.storage.authorized).toHaveLength(signedBefore + 1);

    // Once the upload is complete there is nothing left to authorize.
    await uploadObject(capture.id);
    await completeUpload({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId: capture.id,
      input: { sizeBytes: AUDIO_BYTES },
    });
    const afterUpload = await getCapture({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId: capture.id,
    });
    expect(afterUpload.upload).toBeNull();
    expect(afterUpload.audioAsset?.status).toBe("uploaded");
  });

  it("refuses to allocate a recording at all when storage is not configured", async () => {
    const withoutStorage = { ...harness.deps, storage: null };
    await expect(
      createCapture({ deps: withoutStorage, actorUserId: ownerId, input: audioRequest() }),
    ).rejects.toBeInstanceOf(ApiHttpError);
  });
});
