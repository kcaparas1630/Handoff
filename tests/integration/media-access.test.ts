// Who may be signed for which attachment. The milestone 4 acceptance gate names this matrix:
// author, owner, linked reader, wrong child, wrong tenant, revoked member, for images and videos,
// plus the separate source restriction on raw audio. Real Postgres, real encryption, real
// authorization; only the object store is a fake, because the assertions are about who the server
// hands a URL to and never about the URL itself.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as mediaRepository from "../../packages/db/src/repositories/media";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { createCapture } from "../../packages/server/src/services/captures";
import {
  completeAssetUpload,
  createAssetUpload,
  getAssetReadUrl,
} from "../../packages/server/src/services/media";
import { revokeMember } from "../../packages/server/src/services/memberships";
import { completeUpload } from "../../packages/server/src/services/uploads";
import { createJobHarness } from "./support/job-harness";
import { jpegImage, mp4Video } from "./support/media-fixtures";
import {
  createHarness,
  grantChild,
  seedChild,
  seedUser,
  seedWorkspace,
} from "./support/service-harness";
import { missingDatabaseUrlMessage } from "./support/test-database";
import type { MediaStatus } from "../../packages/db/src/types/enums";
import type { JobHarness } from "./support/job-harness";
import type { TestHarness } from "./support/service-harness";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping media access tests. ${missingDatabaseUrlMessage}`);

const NOT_FOUND = { status: 404, code: "not_found" };

describeIntegration("media access", () => {
  let harness: TestHarness;
  let jobs: JobHarness;
  let workspaceId: string;
  let clerkOrgId: string;
  let ownerId: string;
  let authorId: string;
  let readerId: string;
  let otherContributorId: string;
  let colleagueId: string;
  let childId: string;
  let otherChildId: string;
  let outsiderId: string;
  let outsiderWorkspaceId: string;
  let outsiderChildId: string;

  beforeAll(async () => {
    harness = await createHarness();
    jobs = createJobHarness(harness);

    const workspace = await seedWorkspace(harness, { label: "mediaaccess" });
    workspaceId = workspace.workspaceId;
    clerkOrgId = workspace.clerkOrgId;
    ownerId = workspace.ownerId;
    childId = await seedChild(harness, { workspaceId, ownerId, name: "Rowan" });
    otherChildId = await seedChild(harness, { workspaceId, ownerId, name: "Sasha" });

    authorId = await seedUser(harness, { label: "ma_author", clerkOrgId, role: "member" });
    readerId = await seedUser(harness, { label: "ma_reader", clerkOrgId, role: "guardian" });
    otherContributorId = await seedUser(harness, { label: "ma_other", clerkOrgId, role: "member" });
    // Granted the same child as the author: an ordinary colleague, not an outsider.
    colleagueId = await seedUser(harness, { label: "ma_colleague", clerkOrgId, role: "member" });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [
        { userId: authorId, relationship: "caregiver", permission: "contributor" },
        { userId: readerId, relationship: "parent", permission: "reader" },
        { userId: colleagueId, relationship: "caregiver", permission: "contributor" },
      ],
    });
    // Granted the other child only, which is what makes it a wrong-child case rather than a
    // wrong-workspace one.
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId: otherChildId,
      grants: [
        { userId: otherContributorId, relationship: "caregiver", permission: "contributor" },
      ],
    });

    const outsiderWorkspace = await seedWorkspace(harness, { label: "mediaoutsider" });
    outsiderWorkspaceId = outsiderWorkspace.workspaceId;
    outsiderId = outsiderWorkspace.ownerId;
    outsiderChildId = await seedChild(harness, {
      workspaceId: outsiderWorkspaceId,
      ownerId: outsiderId,
      name: "Kai",
    });
    await setBudget(50_000_000);
  }, 120_000);

  afterAll(async () => {
    await jobs?.close();
    await harness?.close();
  });

  beforeEach(() => {
    jobs.storage.readUrls.length = 0;
  });

  async function setBudget(bytes: number): Promise<void> {
    await harness.admin.db.execute(sql`
      update handoff.workspaces
      set storage_budget_bytes = ${bytes}, storage_reserved_bytes = 0, storage_used_bytes = 0
    `);
  }

  /** A manual capture, which arrives already reviewed and so can take an attachment at once. */
  async function manualCapture(actorUserId: string, forChildId: string): Promise<string> {
    const capture = await createCapture({
      deps: harness.deps,
      actorUserId,
      input: {
        childId: forChildId,
        clientCaptureId: randomUUID(),
        inputKind: "manual",
        capturedAt: new Date().toISOString(),
        timezone: "America/Vancouver",
        locale: "en-CA",
        candidates: [],
      },
    });
    return capture.id;
  }

  interface Attachment {
    assetId: string;
    captureId: string;
  }

  /** Allocates, stores, completes, and validates one attachment, leaving it `ready`. */
  async function attachReady(input: {
    actorUserId: string;
    childId: string;
    kind: "image" | "video";
    workspaceId?: string;
  }): Promise<Attachment> {
    const tenantId = input.workspaceId ?? workspaceId;
    const captureId = await manualCapture(input.actorUserId, input.childId);
    const bytes = input.kind === "image" ? (await jpegImage()).bytes : mp4Video();
    const declaredMime = input.kind === "image" ? "image/jpeg" : "video/mp4";
    const created = await createAssetUpload({
      deps: harness.deps,
      actorUserId: input.actorUserId,
      captureId,
      input: {
        kind: input.kind,
        declaredMime,
        declaredSizeBytes: bytes.byteLength,
        ...(input.kind === "video" ? { declaredDurationMs: 8_000 } : {}),
      },
    });
    const asset = await readAsset(created.asset.id, tenantId);
    jobs.storage.put(asset?.objectKey ?? "", bytes, declaredMime);
    await completeAssetUpload({
      deps: harness.deps,
      actorUserId: input.actorUserId,
      assetId: created.asset.id,
      input: { sizeBytes: bytes.byteLength },
    });
    await jobs.runner.runOnce();
    return { assetId: created.asset.id, captureId };
  }

  function readAsset(assetId: string, tenantId = workspaceId) {
    return withTenantTransaction(harness.deps.db, { workspaceId: tenantId }, (tx) =>
      mediaRepository.findMediaAssetInWorkspace(tx, tenantId, assetId),
    );
  }

  function sign(actorUserId: string, assetId: string) {
    return getAssetReadUrl({ deps: harness.deps, actorUserId, assetId });
  }

  /** Moves an asset straight into a state the server must refuse to sign. */
  async function forceStatus(assetId: string, status: MediaStatus): Promise<void> {
    await harness.admin.db.execute(
      sql`update handoff.media_assets set status = ${status}::handoff.media_status where id = ${assetId}`,
    );
  }

  it("signs a ready photo for its author, a workspace owner, and a linked reader", async () => {
    const photo = await attachReady({ actorUserId: authorId, childId, kind: "image" });
    expect((await readAsset(photo.assetId))?.status).toBe("ready");

    for (const userId of [authorId, ownerId, readerId]) {
      const signed = await sign(userId, photo.assetId);
      expect(signed.asset.id).toBe(photo.assetId);
      expect(signed.asset.status).toBe("ready");
      expect(new Date(signed.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
    // Three signatures, and the URL exists only in the response: it is not in the DTO.
    expect(jobs.storage.readUrls).toHaveLength(3);
    const signed = await sign(readerId, photo.assetId);
    expect(Object.keys(signed.asset)).not.toContain("url");
    expect(JSON.stringify(signed.asset)).not.toContain("storage.test");
  });

  it("signs a ready video on the same matrix", async () => {
    const video = await attachReady({ actorUserId: authorId, childId, kind: "video" });
    const asset = await readAsset(video.assetId);
    expect(asset?.status).toBe("ready");
    expect(asset?.durationMs).toBe(8_000);

    for (const userId of [authorId, ownerId, readerId]) {
      expect((await sign(userId, video.assetId)).asset.kind).toBe("video");
    }
  });

  it("hides an attachment from a caregiver granted a different child in the same workspace", async () => {
    const photo = await attachReady({ actorUserId: authorId, childId, kind: "image" });
    await expect(sign(otherContributorId, photo.assetId)).rejects.toMatchObject(NOT_FOUND);
    // The same caregiver can sign an attachment on the child they were granted.
    const theirs = await attachReady({
      actorUserId: otherContributorId,
      childId: otherChildId,
      kind: "image",
    });
    expect((await sign(otherContributorId, theirs.assetId)).asset.childId).toBe(otherChildId);
  });

  it("hides an attachment from another tenant, in both directions", async () => {
    const photo = await attachReady({ actorUserId: authorId, childId, kind: "image" });
    await expect(sign(outsiderId, photo.assetId)).rejects.toMatchObject(NOT_FOUND);

    const theirs = await attachReady({
      actorUserId: outsiderId,
      childId: outsiderChildId,
      kind: "image",
      workspaceId: outsiderWorkspaceId,
    });
    await expect(sign(ownerId, theirs.assetId)).rejects.toMatchObject(NOT_FOUND);
  });

  it("stops signing for a member whose workspace membership was revoked", async () => {
    const revokedId = await seedUser(harness, {
      label: `ma_revoked_${randomUUID().slice(0, 8)}`,
      clerkOrgId,
      role: "member",
    });
    await grantChild(harness, {
      workspaceId,
      ownerId,
      childId,
      grants: [{ userId: revokedId, relationship: "caregiver", permission: "contributor" }],
    });
    const photo = await attachReady({ actorUserId: revokedId, childId, kind: "image" });
    expect((await sign(revokedId, photo.assetId)).asset.id).toBe(photo.assetId);

    await revokeMember({
      deps: harness.deps,
      actorUserId: ownerId,
      workspaceId,
      targetUserId: revokedId,
    });
    // Already-issued URLs stay usable until they expire (architecture §6); no new one is issued.
    await expect(sign(revokedId, photo.assetId)).rejects.toMatchObject(NOT_FOUND);
    // The photo itself is unaffected for everyone else.
    expect((await sign(ownerId, photo.assetId)).asset.id).toBe(photo.assetId);
  });

  it("never signs an attachment nobody has validated, for anybody", async () => {
    const photo = await attachReady({ actorUserId: authorId, childId, kind: "image" });
    for (const status of ["pending_upload", "uploaded", "rejected"] as const) {
      await forceStatus(photo.assetId, status);
      for (const userId of [authorId, ownerId, readerId]) {
        await expect(sign(userId, photo.assetId)).rejects.toMatchObject(NOT_FOUND);
      }
    }
    expect(jobs.storage.readUrls).toHaveLength(0);
  });

  it("keeps raw audio to its author and the workspace owner", async () => {
    const transcript = "Fed 90 ml at two am.";
    const capture = await createCapture({
      deps: harness.deps,
      actorUserId: authorId,
      input: {
        childId,
        clientCaptureId: randomUUID(),
        inputKind: "audio",
        capturedAt: new Date().toISOString(),
        timezone: "America/Vancouver",
        locale: "en-CA",
        audio: {
          declaredMime: "audio/m4a",
          declaredSizeBytes: Buffer.byteLength(transcript),
          declaredDurationMs: 5_000,
        },
      },
    });
    const audioAssetId = capture.audioAsset?.id ?? "";
    const asset = await readAsset(audioAssetId);
    jobs.storage.put(asset?.objectKey ?? "", Buffer.from(transcript, "utf8"), "audio/m4a");
    await completeUpload({
      deps: harness.deps,
      actorUserId: authorId,
      captureId: capture.id,
      input: { sizeBytes: Buffer.byteLength(transcript) },
    });

    // §7 "Read another author's raw draft/audio": owner only. A recording is source material,
    // not a gallery attachment, so ordinary contributor and reader access does not reach it.
    expect((await sign(authorId, audioAssetId)).asset.kind).toBe("audio");
    expect((await sign(ownerId, audioAssetId)).asset.kind).toBe("audio");
    // A colleague with the same child grant still cannot reach the recording.
    await expect(sign(colleagueId, audioAssetId)).rejects.toMatchObject(NOT_FOUND);
    await expect(sign(readerId, audioAssetId)).rejects.toMatchObject(NOT_FOUND);
  });
});
