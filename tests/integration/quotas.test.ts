// Quotas authorize resource creation before any storage or provider work (architecture §9), and
// the daily spend cap stops the paid call rather than the recording. Manual entry is never refused
// by either: it calls no provider, which is the property that keeps the product usable when the
// budget is spent.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as capturesRepository from "../../packages/db/src/repositories/captures";
import * as mediaRepository from "../../packages/db/src/repositories/media";
import * as providerUsageRepository from "../../packages/db/src/repositories/provider-usage";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { PROVIDER_RATES } from "../../packages/server/src/lib/provider-rates";
import { createCapture } from "../../packages/server/src/services/captures";
import { completeUpload } from "../../packages/server/src/services/uploads";
import { utcDay } from "../../packages/server/src/services/quotas";
import { createJobHarness } from "./support/job-harness";
import { candidate } from "./support/journal-fixtures";
import { createHarness, seedChild, seedWorkspace } from "./support/service-harness";
import { missingDatabaseUrlMessage } from "./support/test-database";
import type { CreateCaptureRequest } from "../../packages/contracts/src/index";
import type { JobHarness } from "./support/job-harness";
import type { TestHarness } from "./support/service-harness";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL) console.warn(`Skipping quota tests. ${missingDatabaseUrlMessage}`);

const AUDIO_BYTES = 2_048;

describeIntegration("quotas", () => {
  let harness: TestHarness;
  let jobs: JobHarness;
  let workspaceId: string;
  let ownerId: string;
  let childId: string;

  beforeAll(async () => {
    harness = await createHarness();
    jobs = createJobHarness(harness);
    const workspace = await seedWorkspace(harness, { label: "quota" });
    workspaceId = workspace.workspaceId;
    ownerId = workspace.ownerId;
    childId = await seedChild(harness, { workspaceId, ownerId, name: "Marker-Quota" });
  }, 120_000);

  afterAll(async () => {
    await jobs?.close();
    await harness?.close();
  });

  beforeEach(() => {
    harness.deps.limits.capturesPerUserPerDay = 200;
    harness.deps.limits.audioSecondsPerWorkspacePerDay = 3600;
    harness.deps.limits.extractionUsdPerWorkspacePerDay = 5;
  });

  function manualRequest(): CreateCaptureRequest {
    return {
      childId,
      clientCaptureId: randomUUID(),
      inputKind: "manual",
      capturedAt: new Date().toISOString(),
      timezone: "America/Vancouver",
      locale: "en-CA",
      candidates: [candidate({ kind: "note" })],
    };
  }

  function audioRequest(durationMs: number): CreateCaptureRequest {
    return {
      childId,
      clientCaptureId: randomUUID(),
      inputKind: "audio",
      capturedAt: new Date().toISOString(),
      timezone: "America/Vancouver",
      locale: "en-CA",
      audio: {
        declaredMime: "audio/m4a",
        declaredSizeBytes: AUDIO_BYTES,
        declaredDurationMs: durationMs,
      },
    };
  }

  function create(input: CreateCaptureRequest) {
    return createCapture({ deps: harness.deps, actorUserId: ownerId, input });
  }

  function countCaptures() {
    return withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      capturesRepository.countCapturesByAuthorSince(tx, {
        workspaceId,
        authorUserId: ownerId,
        since: new Date(0),
      }),
    );
  }

  it("refuses a caregiver's captures once they reach the daily cap, retryably", async () => {
    const already = await countCaptures();
    harness.deps.limits.capturesPerUserPerDay = already + 1;

    await create(manualRequest());
    const refused = await create(manualRequest()).catch((error: unknown) => error);
    expect(refused).toMatchObject({ status: 422, code: "rate_limited", retryable: true });
    // The message is a plain sentence with no counters or identifiers in it.
    expect(String((refused as Error).message)).toMatch(/try again tomorrow/i);

    // Nothing was written: the cap is checked before the row, not after.
    expect(await countCaptures()).toBe(already + 1);
  });

  it("refuses a recording that would exceed the workspace's daily audio seconds", async () => {
    harness.deps.limits.audioSecondsPerWorkspacePerDay = 30;

    const accepted = await create(audioRequest(25_000));
    expect(accepted.status).toBe("awaiting_upload");
    const allocated = accepted.audioAsset;
    if (allocated == null) throw new Error("expected an allocated audio asset");
    // The DTO never carries a storage path, so the object key comes from the row the server owns.
    const asset = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      mediaRepository.findMediaAssetInWorkspace(tx, workspaceId, allocated.id),
    );
    if (asset === null) throw new Error("expected the allocated asset row");

    // Counted from what was actually uploaded, so the reported duration is what the cap sees.
    jobs.storage.put(asset.objectKey, Buffer.alloc(AUDIO_BYTES), "audio/m4a");
    await completeUpload({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId: accepted.id,
      input: { sizeBytes: AUDIO_BYTES, durationMs: 25_000 },
    });

    const refused = await create(audioRequest(10_000)).catch((error: unknown) => error);
    expect(refused).toMatchObject({ status: 422, code: "rate_limited", retryable: true });
    expect(String((refused as Error).message)).toMatch(/type or add entries/i);

    // Nothing was signed for the refused recording: the check runs before any storage work.
    expect(jobs.storage.authorized.filter((key) => key.includes(childId))).toHaveLength(1);
  });

  it("fails a capture with budget_exceeded instead of calling the model, and leaves manual entry alone", async () => {
    // Book yesterday's worth of tokens against today so the cap is already spent.
    const tokens = Math.ceil((1e6 * 1) / PROVIDER_RATES.anthropicInputUsdPerMTok);
    harness.deps.limits.extractionUsdPerWorkspacePerDay = 0.5;
    await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      providerUsageRepository.addProviderUsage(tx, {
        workspaceId,
        day: utcDay(harness.deps.now()),
        tokensIn: tokens,
        tokensOut: 0,
        audioSeconds: 0,
      }),
    );

    const typed = await create({
      childId,
      clientCaptureId: randomUUID(),
      inputKind: "text",
      capturedAt: new Date().toISOString(),
      timezone: "America/Vancouver",
      locale: "en-CA",
      text: "She had 120 ml at nine.",
    });
    const extractionsBefore = jobs.extraction.calls.length;
    await jobs.runner.runOnce();

    // The model was never asked, and the caregiver sees a capture that failed for a stated reason.
    expect(jobs.extraction.calls.length).toBe(extractionsBefore);
    const capture = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      capturesRepository.findCaptureInWorkspace(tx, workspaceId, typed.id),
    );
    expect(capture?.status).toBe("failed");
    expect(capture?.errorCode).toBe("budget_exceeded");

    // Manual entry does not call a provider, so a spent budget never blocks care being recorded.
    const manual = await create(manualRequest());
    expect(manual.status).toBe("needs_review");
  });
});
