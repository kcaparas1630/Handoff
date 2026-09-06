// Roadmap milestone 2 gate: journal read and template brief creation against 10,000 synthetic
// revisions for one child. Opt in with HANDOFF_PERF=1; it takes minutes and measures a laptop,
// not the deployment target, so it is not part of the default suite.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTransaction } from "../../packages/db/src/tenant-transaction";
import { acknowledgeBrief } from "../../packages/server/src/services/handoff-acknowledgement";
import { listInitialWindowRevisions } from "../../packages/db/src/repositories/events";
import { confirmCapture } from "../../packages/server/src/services/capture-confirmation";
import { createCapture } from "../../packages/server/src/services/captures";
import { listEvents } from "../../packages/server/src/services/events";
import { createBrief } from "../../packages/server/src/services/handoffs";
import { candidate } from "./support/journal-fixtures";
import {
  createHarness,
  grantChild,
  seedChild,
  seedUser,
  seedWorkspace,
} from "./support/service-harness";
import type { TestHarness } from "./support/service-harness";

const enabled = process.env.HANDOFF_PERF === "1" && process.env.DATABASE_URL !== undefined;
const describePerf = enabled ? describe : describe.skip;
if (!enabled) console.warn("Skipping journal performance test. Set HANDOFF_PERF=1 to run it.");

const CAPTURES = 100;
const CANDIDATES_PER_CAPTURE = 100;
const READ_RUNS = 20;
const BRIEF_RUNS = 5;

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function measure(runs: number, run: () => Promise<unknown>): Promise<number[]> {
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const startedAt = performance.now();
    await run();
    samples.push(performance.now() - startedAt);
  }
  return samples;
}

describePerf("journal performance", () => {
  let harness: TestHarness;
  let workspaceId: string;
  let childId: string;
  let authorId: string;
  let recipientId: string;

  async function confirmBatch(count: number): Promise<void> {
    const candidates = Array.from({ length: count }, (_unused, index) =>
      candidate({ kind: "feed", occurredAt: new Date(Date.now() - index * 1000).toISOString() }),
    );
    const capture = await createCapture({
      deps: harness.deps,
      actorUserId: authorId,
      input: {
        childId,
        clientCaptureId: randomUUID(),
        inputKind: "manual",
        capturedAt: new Date().toISOString(),
        timezone: "UTC",
        locale: "en-CA",
        candidates,
      },
    });
    await confirmCapture({
      deps: harness.deps,
      actorUserId: authorId,
      captureId: capture.id,
      input: {
        expectedDraftVersion: capture.draftVersion,
        candidates: candidates.map(({ sourceStart: _s, sourceEnd: _e, ...rest }) => rest),
      },
    });
  }

  async function explainWindowQuery(): Promise<string> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await withTenantTransaction(harness.api.db, { workspaceId }, (tx) =>
      tx.execute(sql`
        explain (analyze, buffers)
        select r.* from handoff.event_revisions r
        join handoff.events e
          on e.workspace_id = r.workspace_id and e.child_id = r.child_id and e.id = r.event_id
        where r.workspace_id = ${workspaceId}::uuid
          and r.child_id = ${childId}::uuid
          and r.journal_seq <= ${CAPTURES * CANDIDATES_PER_CAPTURE}
          and (r.created_at >= ${since.toISOString()}::timestamptz or e.occurred_at >= ${since.toISOString()}::timestamptz)
        order by r.journal_seq
      `),
    );
    return rows.map((row) => String(Object.values(row)[0])).join("\n");
  }

  beforeAll(async () => {
    harness = await createHarness();
    const workspace = await seedWorkspace(harness, { label: "perf", timezone: "UTC" });
    workspaceId = workspace.workspaceId;
    authorId = await seedUser(harness, {
      label: "perf_author",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
      displayName: "Ana Author",
    });
    recipientId = await seedUser(harness, {
      label: "perf_recipient",
      clerkOrgId: workspace.clerkOrgId,
      role: "member",
      displayName: "Rae Recipient",
    });
    childId = await seedChild(harness, {
      workspaceId: workspace.workspaceId,
      ownerId: workspace.ownerId,
      name: "Perf",
    });
    await grantChild(harness, {
      workspaceId: workspace.workspaceId,
      ownerId: workspace.ownerId,
      childId,
      grants: [
        { userId: authorId, relationship: "caregiver", permission: "contributor" },
        { userId: recipientId, relationship: "caregiver", permission: "contributor" },
      ],
    });

    const seedingStartedAt = performance.now();
    for (let batch = 0; batch < CAPTURES; batch += 1) {
      await confirmBatch(CANDIDATES_PER_CAPTURE);
    }
    console.log(
      `seeded ${String(CAPTURES * CANDIDATES_PER_CAPTURE)} revisions in ${(performance.now() - seedingStartedAt).toFixed(0)} ms`,
    );
  }, 1_800_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("reads the first journal page and builds a brief over 10,000 revisions", async () => {
    const reads = await measure(READ_RUNS, () =>
      listEvents({
        deps: harness.deps,
        actorUserId: recipientId,
        childId,
        query: { limit: 20 },
      }),
    );
    const briefs = await measure(BRIEF_RUNS, () =>
      createBrief({ deps: harness.deps, actorUserId: recipientId, childId }),
    );

    console.log(
      `listEvents first page: p50 ${percentile(reads, 0.5).toFixed(1)} ms, p95 ${percentile(reads, 0.95).toFixed(1)} ms`,
    );
    console.log(
      `createBrief over ${String(CAPTURES * CANDIDATES_PER_CAPTURE)} revisions: p50 ${percentile(briefs, 0.5).toFixed(0)} ms, p95 ${percentile(briefs, 0.95).toFixed(0)} ms`,
    );

    // How much of that is the window query itself, as opposed to decrypting and rendering it.
    const fetches = await measure(READ_RUNS, () =>
      withTenantTransaction(harness.api.db, { workspaceId }, (tx) =>
        listInitialWindowRevisions(tx, {
          workspaceId,
          childId,
          throughSeqInclusive: CAPTURES * CANDIDATES_PER_CAPTURE,
          since: new Date(Date.now() - 24 * 60 * 60 * 1000),
        }),
      ),
    );
    console.log(
      `window query alone: p50 ${percentile(fetches, 0.5).toFixed(0)} ms, p95 ${percentile(fetches, 0.95).toFixed(0)} ms`,
    );
    console.log(await explainWindowQuery());

    // The everyday shape: a journal of 10,000 revisions, of which this recipient has not yet read
    // the last fifty.
    const latest = await createBrief({ deps: harness.deps, actorUserId: recipientId, childId });
    await acknowledgeBrief({
      deps: harness.deps,
      actorUserId: recipientId,
      briefId: latest.id,
      input: { startCare: false },
    });
    await confirmBatch(50);
    const incremental = await measure(BRIEF_RUNS, () =>
      createBrief({ deps: harness.deps, actorUserId: recipientId, childId }),
    );
    console.log(
      `createBrief over 50 unacknowledged changes in a 10,050 revision journal: p50 ${percentile(incremental, 0.5).toFixed(0)} ms, p95 ${percentile(incremental, 0.95).toFixed(0)} ms`,
    );
    // The numbers are reported rather than asserted: the gate is a target for the deployed
    // environment, and a developer laptop is not that environment.
    expect(reads).toHaveLength(READ_RUNS);
    expect(briefs).toHaveLength(BRIEF_RUNS);
  }, 900_000);
});
