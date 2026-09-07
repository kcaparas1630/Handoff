// Per-user and per-workspace ceilings, checked before anything is reserved or sent to a provider
// (architecture §9). A caregiver who meets one gets a plain retryable message and can still enter
// care by hand: manual entry never calls a provider, so it is never refused by a spend cap.
//
// Everything here counts rows the workspace already has. There is no separate usage ledger for
// captures or audio; the only counted-in-advance number is provider spend, which nothing else
// records, so `provider_usage` holds it. Day boundaries are UTC, like the retention sweeps.
import {
  capturesRepository,
  mediaRepository,
  providerUsageRepository,
  withTenantTransaction,
} from "@handoff/db";
import type { HandoffTransaction } from "@handoff/db";
import { ApiHttpError } from "../http/errors";
import { estimateProviderSpendUsd } from "../lib/provider-rates";
import type { ServiceDeps } from "../types/runtime";
import type { WorkerRuntime } from "../types/runtime";

const MS_PER_SECOND = 1000;

/** The UTC calendar day a `provider_usage` row is keyed by. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function startOfUtcDay(now: Date): Date {
  return new Date(`${utcDay(now)}T00:00:00.000Z`);
}

function refuse(message: string): never {
  // 422 with a retryable code: the request was well formed and will work again tomorrow.
  throw new ApiHttpError({ status: 422, code: "rate_limited", message, retryable: true });
}

/**
 * How many recordings, notes, and manual entries one caregiver may start in this workspace today.
 * Cancelled and failed captures count: the cap bounds what the server was asked to do.
 */
export async function assertCaptureQuota({
  deps,
  tx,
  workspaceId,
  userId,
}: {
  deps: ServiceDeps;
  tx: HandoffTransaction;
  workspaceId: string;
  userId: string;
}): Promise<void> {
  const used = await capturesRepository.countCapturesByAuthorSince(tx, {
    workspaceId,
    authorUserId: userId,
    since: startOfUtcDay(deps.now()),
  });
  if (used < deps.limits.capturesPerUserPerDay) return;
  deps.metrics.incrementCounter("quota_refusals", { status: "captures_per_user" });
  refuse("You have added a lot of entries today. Please try again tomorrow.");
}

/**
 * Audio seconds this workspace may send to transcription today, including the recording being
 * authorized. An allocation nobody uploaded costs nothing and is not counted.
 */
export async function assertAudioQuota({
  deps,
  tx,
  workspaceId,
  seconds,
}: {
  deps: ServiceDeps;
  tx: HandoffTransaction;
  workspaceId: string;
  seconds: number;
}): Promise<void> {
  const usedMs = await mediaRepository.sumAudioDurationMsSince(tx, {
    workspaceId,
    since: startOfUtcDay(deps.now()),
  });
  const total = usedMs / MS_PER_SECOND + seconds;
  if (total <= deps.limits.audioSecondsPerWorkspacePerDay) return;
  deps.metrics.incrementCounter("quota_refusals", { status: "audio_seconds" });
  refuse("This workspace has reached today's recording limit. You can still type or add entries.");
}

/** Thrown by the extraction budget check so the job can fail the capture with its own code. */
export class BudgetExceededError extends Error {
  constructor() {
    super("budget_exceeded");
    this.name = "BudgetExceededError";
  }
}

/**
 * Worker side. Estimated spend already booked for this workspace today, priced with the same
 * constants the evaluation script reports against, compared with the configured daily ceiling.
 */
export async function assertExtractionBudget({
  runtime,
  workspaceId,
}: {
  runtime: WorkerRuntime;
  workspaceId: string;
}): Promise<void> {
  const day = utcDay(runtime.now());
  const usage = await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    providerUsageRepository.findProviderUsage(tx, workspaceId, day),
  );
  if (usage === null) return;
  const spent = estimateProviderSpendUsd({
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    audioSeconds: usage.audioSeconds,
  });
  if (spent < runtime.limits.extractionUsdPerWorkspacePerDay) return;
  runtime.metrics.incrementCounter("quota_refusals", { status: "extraction_budget" });
  throw new BudgetExceededError();
}

/**
 * Records what a job actually spent, after the provider answered. The counters are also the
 * metrics the runbook's spend threshold is read from, so both move together.
 */
export async function recordProviderUsage({
  runtime,
  workspaceId,
  tokensIn = 0,
  tokensOut = 0,
  audioSeconds = 0,
}: {
  runtime: WorkerRuntime;
  workspaceId: string;
  tokensIn?: number;
  tokensOut?: number;
  audioSeconds?: number;
}): Promise<void> {
  await withTenantTransaction(runtime.db, { workspaceId }, (tx) =>
    providerUsageRepository.addProviderUsage(tx, {
      workspaceId,
      day: utcDay(runtime.now()),
      tokensIn,
      tokensOut,
      audioSeconds,
    }),
  );
  const labels = { workspaceId };
  if (tokensIn > 0) runtime.metrics.incrementCounter("provider_tokens_in", labels, tokensIn);
  if (tokensOut > 0) runtime.metrics.incrementCounter("provider_tokens_out", labels, tokensOut);
  if (audioSeconds > 0) {
    runtime.metrics.incrementCounter("provider_audio_seconds", labels, audioSeconds);
  }
}
