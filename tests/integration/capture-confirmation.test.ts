// Transcript to reviewable draft to confirmed events. The extraction provider is a fake that
// answers with the labelled fixtures in tests/fixtures/extraction-cases.jsonl, so what is asserted
// here is what the pipeline does with independently authored expectations.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isCompletedCareCandidate } from "../../packages/domain/src/index";
import * as jobsRepository from "../../packages/db/src/repositories/jobs";
import {
  withJobTransaction,
  withTenantTransaction,
} from "../../packages/db/src/tenant-transaction";
import { ProviderError } from "../../packages/server/src/lib/provider-error";
import { confirmCapture } from "../../packages/server/src/services/capture-confirmation";
import { createCapture, getCapture } from "../../packages/server/src/services/captures";
import { processCaptureDedupeKey } from "../../packages/server/src/services/job-keys";
import { extractionCase, outputForCase } from "./support/extraction-cases";
import { createJobHarness } from "./support/job-harness";
import { createHarness, seedChild, seedWorkspace } from "./support/service-harness";
import { missingDatabaseUrlMessage } from "./support/test-database";
import type { CaptureDto, DraftCandidate } from "../../packages/contracts/src/index";
import type { JobHarness } from "./support/job-harness";
import type { TestHarness } from "./support/service-harness";

const describeIntegration = process.env.DATABASE_URL ? describe : describe.skip;
if (!process.env.DATABASE_URL)
  console.warn(`Skipping capture confirmation tests. ${missingDatabaseUrlMessage}`);

describeIntegration("capture processing and confirmation", () => {
  let harness: TestHarness;
  let jobs: JobHarness;
  let workspaceId: string;
  let ownerId: string;
  let childId: string;

  beforeAll(async () => {
    harness = await createHarness();
    jobs = createJobHarness(harness);
    const workspace = await seedWorkspace(harness, { label: "extract" });
    workspaceId = workspace.workspaceId;
    ownerId = workspace.ownerId;
    childId = await seedChild(harness, { workspaceId, ownerId, name: "Milo Chen" });
  }, 90_000);

  afterAll(async () => {
    await jobs?.close();
    await harness?.close();
  });

  /** Creates a typed capture from a fixture and lets the worker process it once. */
  async function processFixture(caseId: string): Promise<CaptureDto> {
    const fixture = extractionCase(caseId);
    const created = await createCapture({
      deps: harness.deps,
      actorUserId: ownerId,
      input: {
        childId,
        clientCaptureId: randomUUID(),
        inputKind: "text",
        capturedAt: fixture.recordingStartedAt,
        timezone: fixture.timezone,
        locale: fixture.locale,
        text: fixture.transcript,
      },
    });
    expect(created.status).toBe("queued");
    await jobs.runner.runOnce();
    return getCapture({ deps: harness.deps, actorUserId: ownerId, captureId: created.id });
  }

  function onlyCandidate(capture: CaptureDto): DraftCandidate {
    const candidate = capture.draft?.candidates[0];
    if (candidate === undefined) throw new Error("expected one draft candidate");
    return candidate;
  }

  it("sends only the transcript and its formatting context to the extractor", async () => {
    const before = jobs.extraction.calls.length;
    await processFixture("ex-001");
    const call = jobs.extraction.calls[before];

    expect(call?.rawTranscript).toBe(extractionCase("ex-001").transcript);
    expect(call?.childAlias).toBe("Milo");
    // The whole request: no birthdate, no roster, no history, no workspace or child id.
    expect(Object.keys(call ?? {}).sort()).toEqual([
      "childAlias",
      "locale",
      "promptVersion",
      "rawTranscript",
      "recordingStartedAt",
      "schemaVersion",
      "timezone",
    ]);
  });

  it("resolves a spoken time into a reviewable proposal and records the provider metadata", async () => {
    const capture = await processFixture("ex-001");
    expect(capture.status).toBe("needs_review");

    const candidate = onlyCandidate(capture);
    expect(candidate.kind).toBe("feed");
    expect(candidate.amountValue).toBe("60");
    expect(candidate.amountUnit).toBe("ml");
    // 02:00 on the recording's own day in America/Vancouver, which is 09:00Z in September.
    expect(candidate.occurredAt).toBe("2026-09-05T09:00:00.000Z");
    expect(candidate.timePrecision).toBe("exact");
    expect(candidate.ambiguities).toContain("date_unknown");
    expect(candidate.sourceQuote).toBe(extractionCase("ex-001").transcript);
    expect(capture.draft?.rawTranscript).toBe(extractionCase("ex-001").transcript);
    expect(isCompletedCareCandidate(candidate)).toBe(true);
  });

  it("never turns a negated statement into completed care", async () => {
    const capture = await processFixture("ex-005");
    const candidate = onlyCandidate(capture);
    expect(candidate.ambiguities).toContain("negation");
    expect(isCompletedCareCandidate(candidate)).toBe(false);
  });

  it("never turns a future intention into completed care", async () => {
    const capture = await processFixture("ex-006");
    const candidate = onlyCandidate(capture);
    expect(candidate.kind).toBe("note");
    expect(candidate.ambiguities).toContain("planned");
    expect(isCompletedCareCandidate(candidate)).toBe(false);
  });

  it("asks for the meridiem instead of choosing one", async () => {
    const capture = await processFixture("ex-008");
    const candidate = onlyCandidate(capture);
    expect(candidate.ambiguities).toContain("am_pm_unknown");
    expect(candidate.occurredAt).not.toBeNull();
  });

  it("flags another child's name and never repoints the capture at that child", async () => {
    const capture = await processFixture("ex-013");
    const candidate = onlyCandidate(capture);
    expect(candidate.ambiguities).toContain("other_child");
    expect(capture.childId).toBe(childId);
  });

  it("produces a reviewable draft with no candidates for silence", async () => {
    const capture = await processFixture("ex-014");
    expect(capture.status).toBe("needs_review");
    expect(capture.draft?.candidates).toEqual([]);
    expect(capture.draft?.rawTranscript).toBe(extractionCase("ex-014").transcript);
  });

  it("treats an instruction inside the transcript as content, not as an instruction", async () => {
    const capture = await processFixture("ex-047");
    expect(capture.status).toBe("needs_review");
    expect(capture.draft?.candidates).toEqual([]);
  });

  it("blocks an unusable extraction response instead of repairing it", async () => {
    const fixture = extractionCase("ex-003");
    jobs.extraction.failWith(
      new ProviderError({ provider: "anthropic", code: "invalid_input", retryable: false }),
    );
    let capture: CaptureDto;
    try {
      capture = await processFixture("ex-003");
    } finally {
      jobs.extraction.failWith(null);
    }

    expect(capture.status).toBe("failed");
    expect(capture.errorCode).toBe("extraction_failed");
    // The transcript survives so the caregiver can retry or type the entry instead.
    expect(capture.draft?.rawTranscript).toBe(fixture.transcript);
    expect(capture.draft?.candidates).toEqual([]);
  });

  it("drops a candidate whose quote is not in the transcript and keeps the rest", async () => {
    const fixture = extractionCase("ex-016");
    const output = outputForCase(fixture);
    const [first, second] = output.candidates;
    if (first === undefined || second === undefined) throw new Error("expected two candidates");
    jobs.extraction.script(fixture.transcript, {
      ...output,
      candidates: [
        first,
        // A span that runs past the end of the transcript cannot be shown as a source.
        { ...second, sourceStart: 0, sourceEnd: fixture.transcript.length + 40 },
      ],
    });

    const capture = await processFixture("ex-016");
    expect(capture.status).toBe("needs_review");
    expect(capture.draft?.candidates).toHaveLength(1);
    expect(capture.draft?.candidates[0]?.kind).toBe("feed");
    expect(capture.draft?.formattedText).toBe(fixture.transcript);
    jobs.extraction.script(fixture.transcript, output);
  });

  it("fails the whole response when it breaks a product rule", async () => {
    const fixture = extractionCase("ex-003");
    const output = outputForCase(fixture);
    const [only] = output.candidates;
    if (only === undefined) throw new Error("expected one candidate");
    jobs.extraction.script(fixture.transcript, {
      ...output,
      candidates: Array.from({ length: 21 }, () => only),
    });

    const capture = await processFixture("ex-003");
    expect(capture.status).toBe("failed");
    expect(capture.errorCode).toBe("extraction_failed");
    jobs.extraction.script(fixture.transcript, output);
  });

  it("publishes the reviewed draft once and never reprocesses a confirmed capture", async () => {
    const capture = await processFixture("ex-016");
    expect(capture.draft?.candidates).toHaveLength(2);
    const callsBefore = jobs.extraction.calls.length;

    const confirmed = await confirmCapture({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId: capture.id,
      input: {
        expectedDraftVersion: capture.draftVersion,
        candidates: (capture.draft?.candidates ?? []).map(
          ({ sourceStart: _start, sourceEnd: _end, ...rest }) => rest,
        ),
      },
    });
    expect(confirmed.capture.status).toBe("confirmed");
    expect(confirmed.events).toHaveLength(2);
    expect(confirmed.events.map((event) => event.kind).sort()).toEqual(["feed", "milestone"]);

    // A duplicate unit of work for a confirmed capture must not touch it or call the provider.
    await withJobTransaction(jobs.dispatcher.db, (tx) =>
      jobsRepository.enqueueJob(tx, {
        kind: "process_capture",
        dedupeKey: `${processCaptureDedupeKey(capture.id)}:replay`,
        workspaceId,
        childId,
        captureId: capture.id,
        payload: { captureId: capture.id },
      }),
    );
    await jobs.runner.runOnce();

    const reread = await getCapture({
      deps: harness.deps,
      actorUserId: ownerId,
      captureId: capture.id,
    });
    expect(reread.status).toBe("confirmed");
    expect(reread.draftVersion).toBe(confirmed.capture.draftVersion);
    expect(jobs.extraction.calls).toHaveLength(callsBefore);
  });

  it("keeps every job payload and checkpoint free of transcript text", async () => {
    const fixture = extractionCase("ex-021");
    const capture = await processFixture("ex-021");
    expect(capture.status).toBe("needs_review");

    const rows = await withTenantTransaction(harness.deps.db, { workspaceId }, (tx) =>
      jobsRepository.findJobByDedupeKey(tx, processCaptureDedupeKey(capture.id)),
    );
    const serialized = JSON.stringify({ payload: rows?.payload, checkpoint: rows?.checkpoint });
    expect(serialized).not.toContain(fixture.transcript);
    expect(serialized).not.toContain("happy");
  });
});
