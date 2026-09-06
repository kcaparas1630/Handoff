import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../packages/db/src/client";
import * as capturesRepository from "../../packages/db/src/repositories/captures";
import * as mediaRepository from "../../packages/db/src/repositories/media";
import * as storageQuotaRepository from "../../packages/db/src/repositories/storage-quota";
import { captures } from "../../packages/db/src/schema";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import type { DbClient } from "../../packages/db/src/client";
import type { HandoffDatabase, HandoffTransaction } from "../../packages/db/src/types/database";
import type { MediaAssetRow, NewMediaAsset } from "../../packages/db/src/types/media";
import type { SeededTenant, TestDatabase } from "./support/test-database";
import {
  createTestDatabase,
  failureMessage,
  missingDatabaseUrlMessage,
  seedChild,
  seedTenant,
  syntheticEnvelope,
} from "./support/test-database";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL) {
  console.warn(`Skipping media lifecycle tests. ${missingDatabaseUrlMessage}`);
}

const storageBudgetBytes = 1_000_000;

describeIntegration("media lifecycle and storage quota", () => {
  let database: TestDatabase;
  let admin: DbClient;
  /** Restricted role, so every write below also passes the media tenant policy. */
  let api: DbClient;
  let tenant: SeededTenant;
  let captureId: string;

  function inTenant<T>(run: (tx: HandoffTransaction) => Promise<T>): Promise<T> {
    return withTenantTransaction(api.db, { workspaceId: tenant.workspaceId }, run);
  }

  async function seedCapture(db: HandoffDatabase, childId: string): Promise<string> {
    const id = randomUUID();
    await withTenantTransaction(db, { workspaceId: tenant.workspaceId }, (tx) =>
      capturesRepository.insertCapture(tx, {
        id,
        workspaceId: tenant.workspaceId,
        childId,
        authorUserId: tenant.userId,
        clientCaptureId: randomUUID(),
        inputKind: "audio",
        capturedAt: new Date(),
        timezone: "America/Vancouver",
        locale: "en-CA",
        contentCiphertext: syntheticEnvelope("draft"),
        schemaVersion: 1,
        status: "needs_review",
      }),
    );
    return id;
  }

  /** Allocation as the upload service performs it: reserve first, then record the object. */
  async function allocateAsset(overrides: Partial<NewMediaAsset> = {}): Promise<MediaAssetRow> {
    const assetId = overrides.id ?? randomUUID();
    const targetCaptureId = overrides.captureId ?? captureId;
    return inTenant(async (tx) => {
      const input: NewMediaAsset = {
        id: assetId,
        workspaceId: tenant.workspaceId,
        childId: tenant.childId,
        captureId: targetCaptureId,
        uploadedByUserId: tenant.userId,
        kind: "audio",
        storageProvider: "supabase",
        bucket: "handoff-media",
        // The server-generated key shape from architecture section 6.
        objectKey: `${tenant.workspaceId}/${tenant.childId}/${targetCaptureId}/${assetId}.m4a`,
        declaredMime: "audio/mp4",
        reservedBytes: 10_000,
        ...overrides,
      };
      const reserved = await storageQuotaRepository.reserveStorageBytes(tx, {
        workspaceId: tenant.workspaceId,
        bytes: input.reservedBytes,
      });
      if (!reserved) throw new Error("expected the reservation to fit the budget");
      return mediaRepository.insertMediaAsset(tx, input);
    });
  }

  function readStorage() {
    return inTenant((tx) => storageQuotaRepository.findWorkspaceStorage(tx, tenant.workspaceId));
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    admin = createDbClient({ url: database.adminUrl, maxConnections: 4 });
    api = createDbClient({ url: database.apiUrl, maxConnections: 8 });
    tenant = await seedTenant(admin.db, "media_tenant", { storageBudgetBytes });
    captureId = await seedCapture(api.db, tenant.childId);
  }, 60_000);

  afterAll(async () => {
    await api?.close();
    await admin?.close();
    await database?.drop();
  });

  it("reserves within the budget and refuses a reservation that would exceed it", async () => {
    const before = await readStorage();
    const headroom = storageBudgetBytes - (before?.reservedBytes ?? 0) - (before?.usedBytes ?? 0);

    const fits = await inTenant((tx) =>
      storageQuotaRepository.reserveStorageBytes(tx, {
        workspaceId: tenant.workspaceId,
        bytes: headroom,
      }),
    );
    expect(fits?.reservedBytes).toBe((before?.reservedBytes ?? 0) + headroom);

    const overBudget = await inTenant((tx) =>
      storageQuotaRepository.reserveStorageBytes(tx, { workspaceId: tenant.workspaceId, bytes: 1 }),
    );
    expect(overBudget).toBeNull();

    const released = await inTenant((tx) =>
      storageQuotaRepository.releaseStorageBytes(tx, {
        workspaceId: tenant.workspaceId,
        reservedBytes: headroom,
      }),
    );
    expect(released?.reservedBytes).toBe(before?.reservedBytes ?? 0);
  });

  it("lets exactly one of two concurrent reservations that together exceed the budget win", async () => {
    const contested = await seedTenant(admin.db, "media_contested", { storageBudgetBytes: 100 });
    const reserve = (bytes: number) =>
      withTenantTransaction(api.db, { workspaceId: contested.workspaceId }, (tx) =>
        storageQuotaRepository.reserveStorageBytes(tx, {
          workspaceId: contested.workspaceId,
          bytes,
        }),
      );

    const [first, second] = await Promise.all([reserve(60), reserve(60)]);
    const winners = [first, second].filter((row) => row !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.reservedBytes).toBe(60);
  });

  it("rejects a completion that reports against a version the asset has moved past", async () => {
    const asset = await allocateAsset();

    const stale = await inTenant((tx) =>
      mediaRepository.markAssetUploaded(tx, {
        workspaceId: tenant.workspaceId,
        assetId: asset.id,
        expectedVersion: asset.version + 1,
        sizeBytes: 9_000,
      }),
    );
    expect(stale).toBeNull();

    const uploaded = await inTenant((tx) =>
      mediaRepository.markAssetUploaded(tx, {
        workspaceId: tenant.workspaceId,
        assetId: asset.id,
        expectedVersion: asset.version,
        sizeBytes: 9_000,
        checksum: "sha256:abc",
        durationMs: 42_000,
      }),
    );
    expect(uploaded?.status).toBe("uploaded");
    expect(uploaded?.sizeBytes).toBe(9_000);
    expect(uploaded?.durationMs).toBe(42_000);

    // The same callback arriving twice finds a version that has already moved on.
    const replayed = await inTenant((tx) =>
      mediaRepository.markAssetUploaded(tx, {
        workspaceId: tenant.workspaceId,
        assetId: asset.id,
        expectedVersion: asset.version,
        sizeBytes: 9_000,
      }),
    );
    expect(replayed).toBeNull();
  });

  it("refuses to skip a step in the media state machine", async () => {
    const asset = await allocateAsset();

    const skipped = await inTenant((tx) =>
      mediaRepository.markAssetReady(tx, {
        workspaceId: tenant.workspaceId,
        assetId: asset.id,
        verifiedMime: "audio/mp4",
      }),
    );
    expect(skipped).toBeNull();

    const deleted = await inTenant((tx) =>
      mediaRepository.markAssetDeleted(tx, {
        workspaceId: tenant.workspaceId,
        assetId: asset.id,
      }),
    );
    expect(deleted).toBeNull();

    const current = await inTenant((tx) =>
      mediaRepository.findMediaAssetInWorkspace(tx, tenant.workspaceId, asset.id),
    );
    expect(current?.status).toBe("pending_upload");
    expect(current?.version).toBe(asset.version);
  });

  it("settles a validated asset's bytes once, however many times validation replays", async () => {
    const before = await readStorage();
    const asset = await allocateAsset({ reservedBytes: 20_000 });

    await inTenant((tx) =>
      mediaRepository.markAssetUploaded(tx, {
        workspaceId: tenant.workspaceId,
        assetId: asset.id,
        expectedVersion: asset.version,
        sizeBytes: 18_000,
      }),
    );

    const settle = () =>
      inTenant(async (tx) => {
        const ready = await mediaRepository.markAssetReady(tx, {
          workspaceId: tenant.workspaceId,
          assetId: asset.id,
          verifiedMime: "audio/mp4",
        });
        if (!ready) return null;
        return storageQuotaRepository.settleStorageBytes(tx, {
          workspaceId: tenant.workspaceId,
          reservedBytes: ready.reservedBytes,
          actualBytes: ready.sizeBytes ?? 0,
        });
      });

    const settled = await settle();
    expect(settled?.reservedBytes).toBe(before?.reservedBytes ?? 0);
    expect(settled?.usedBytes).toBe((before?.usedBytes ?? 0) + 18_000);

    // The worker retried after its response was lost. The cleanup marker stops the second move.
    expect(await settle()).toBeNull();
    const after = await readStorage();
    expect(after?.usedBytes).toBe((before?.usedBytes ?? 0) + 18_000);
    expect(after?.reservedBytes).toBe(before?.reservedBytes ?? 0);

    const ready = await inTenant((tx) =>
      mediaRepository.findMediaAssetInWorkspace(tx, tenant.workspaceId, asset.id),
    );
    expect(ready?.status).toBe("ready");
    expect(ready?.cleanupState).toBe("quota_released");
    expect(ready?.verifiedMime).toBe("audio/mp4");
  });

  it("releases a rejected upload's reservation once, after its object is gone", async () => {
    const before = await readStorage();
    const asset = await allocateAsset({ reservedBytes: 30_000, kind: "image" });
    const reservedDuringUpload = await readStorage();
    expect(reservedDuringUpload?.reservedBytes).toBe((before?.reservedBytes ?? 0) + 30_000);

    const rejected = await inTenant((tx) =>
      mediaRepository.markAssetRejected(tx, { workspaceId: tenant.workspaceId, assetId: asset.id }),
    );
    expect(rejected?.status).toBe("rejected");
    // Rejection alone does not touch the quota: the object still occupies the bucket.
    expect((await readStorage())?.reservedBytes).toBe((before?.reservedBytes ?? 0) + 30_000);

    const cleanup = () =>
      inTenant(async (tx) => {
        const claimed = await mediaRepository.markAssetDeleting(tx, {
          workspaceId: tenant.workspaceId,
          assetId: asset.id,
        });
        // The storage delete happens here, between the claim and the record of it.
        const removed = await mediaRepository.markAssetDeleted(tx, {
          workspaceId: tenant.workspaceId,
          assetId: asset.id,
        });
        if (!removed) return { claimed, released: null };
        const releasable = await mediaRepository.markAssetQuotaReleased(tx, {
          workspaceId: tenant.workspaceId,
          assetId: asset.id,
        });
        if (!releasable) return { claimed, released: null };
        return {
          claimed,
          released: await storageQuotaRepository.releaseStorageBytes(tx, {
            workspaceId: tenant.workspaceId,
            reservedBytes: removed.reservedBytes,
          }),
        };
      });

    const first = await cleanup();
    expect(first.released?.reservedBytes).toBe(before?.reservedBytes ?? 0);

    const replay = await cleanup();
    expect(replay.claimed).toBeNull();
    expect(replay.released).toBeNull();
    expect((await readStorage())?.reservedBytes).toBe(before?.reservedBytes ?? 0);

    const finalRow = await inTenant((tx) =>
      mediaRepository.findMediaAssetInWorkspace(tx, tenant.workspaceId, asset.id),
    );
    expect(finalRow?.status).toBe("deleted");
    expect(finalRow?.cleanupState).toBe("quota_released");
  });

  it("lists only expired pending uploads", async () => {
    const expired = await allocateAsset({
      reservedBytes: 1_000,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const stillValid = await allocateAsset({
      reservedBytes: 1_000,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const noExpiry = await allocateAsset({ reservedBytes: 1_000 });
    const uploadedButExpired = await allocateAsset({
      reservedBytes: 1_000,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await inTenant((tx) =>
      mediaRepository.markAssetUploaded(tx, {
        workspaceId: tenant.workspaceId,
        assetId: uploadedButExpired.id,
        expectedVersion: uploadedButExpired.version,
        sizeBytes: 900,
      }),
    );

    const found = await inTenant((tx) =>
      mediaRepository.listExpiredPendingAssets(tx, new Date(), 50),
    );
    const ids = found.map((row) => row.id);
    expect(ids).toContain(expired.id);
    expect(ids).not.toContain(stillValid.id);
    expect(ids).not.toContain(noExpiry.id);
    expect(ids).not.toContain(uploadedButExpired.id);
  });

  it("lists audio whose capture was confirmed before the retention cutoff", async () => {
    const confirmedCaptureId = await seedCapture(api.db, tenant.childId);
    const oldAudio = await allocateAsset({
      reservedBytes: 1_000,
      captureId: confirmedCaptureId,
      kind: "audio",
    });
    const photo = await allocateAsset({
      reservedBytes: 1_000,
      captureId: confirmedCaptureId,
      kind: "image",
    });
    for (const asset of [oldAudio, photo]) {
      await inTenant(async (tx) => {
        const uploaded = await mediaRepository.markAssetUploaded(tx, {
          workspaceId: tenant.workspaceId,
          assetId: asset.id,
          expectedVersion: asset.version,
          sizeBytes: 900,
        });
        await mediaRepository.markAssetReady(tx, {
          workspaceId: tenant.workspaceId,
          assetId: uploaded?.id ?? "",
          verifiedMime: asset.kind === "audio" ? "audio/mp4" : "image/jpeg",
        });
      });
    }
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await inTenant((tx) =>
      tx
        .update(captures)
        .set({ status: "confirmed", confirmedAt: eightDaysAgo })
        .where(eq(captures.id, confirmedCaptureId)),
    );

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const due = await inTenant((tx) => mediaRepository.listAudioForCleanup(tx, sevenDaysAgo, 50));
    expect(due.map((row) => row.id)).toEqual([oldAudio.id]);

    // Audio confirmed after the cutoff is still inside its retention window.
    const nothingDue = await inTenant((tx) =>
      mediaRepository.listAudioForCleanup(tx, new Date(0), 50),
    );
    expect(nothingDue).toHaveLength(0);
  });

  it("counts and lists a capture's assets", async () => {
    const ownCaptureId = await seedCapture(api.db, tenant.childId);
    await allocateAsset({ reservedBytes: 1_000, captureId: ownCaptureId, kind: "image" });
    await allocateAsset({ reservedBytes: 1_000, captureId: ownCaptureId, kind: "video" });

    const forCapture = {
      workspaceId: tenant.workspaceId,
      childId: tenant.childId,
      captureId: ownCaptureId,
    };
    expect(await inTenant((tx) => mediaRepository.countAssetsForCapture(tx, forCapture))).toBe(2);
    const listed = await inTenant((tx) => mediaRepository.listAssetsForCapture(tx, forCapture));
    expect(listed.map((row) => row.kind)).toEqual(["image", "video"]);
  });

  it("refuses a second asset row for the same stored object", async () => {
    const asset = await allocateAsset({ reservedBytes: 1_000 });

    const found = await inTenant((tx) =>
      mediaRepository.findMediaAssetByObjectKey(tx, {
        storageProvider: asset.storageProvider,
        bucket: asset.bucket,
        objectKey: asset.objectKey,
      }),
    );
    expect(found?.id).toBe(asset.id);

    const message = await failureMessage(() =>
      allocateAsset({ reservedBytes: 1_000, objectKey: asset.objectKey }),
    );
    expect(message).toContain("media_assets_object_key");
  });

  it("refuses an asset whose child does not match its capture", async () => {
    const otherChildId = await seedChild(
      admin.db,
      tenant.workspaceId,
      tenant.userId,
      "media_other_child",
    );

    const message = await failureMessage(() =>
      allocateAsset({ reservedBytes: 1_000, childId: otherChildId }),
    );
    expect(message).toContain("media_assets_capture_fk");
  });
});
