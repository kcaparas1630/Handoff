// The live dashboard projection: latest known care, a short recent-activity preview, who is
// caring now, and the caller's own unread count. It reads and never advances a handoff cursor
// (experience design §6).
import { eventsRepository, overviewRepository, withTenantTransaction } from "@handoff/db";
import { isCompletedCareFact, renderFactText } from "@handoff/domain";
import type { ContextFactKind, EventDto, LatestFact, OverviewDto } from "@handoff/contracts";
import type { EventRow, HandoffTransaction } from "@handoff/db";
import { authorizeChild } from "../auth/authorize";
import { ApiHttpError } from "../http/errors";
import { toEventDto } from "../lib/event-dto";
import { decryptEventPayload } from "../security/journal-fields";
import { decryptChildProfile } from "../security/profile-fields";
import { withRequestKeyCache } from "../security/request-key-cache";
import { toCareSessionDtos } from "./care";
import { resolveChildWorkspace } from "./workspace-lookup";
import type { ServiceDeps } from "../types/runtime";

/** The dashboard preview is a glance, not the journal; the timeline screen pages the rest. */
const RECENT_ACTIVITY_LIMIT = 5;
const UNKNOWN_TIME_LIMIT = 10;
const UNKNOWN_TIME_WINDOW_MS = 24 * 60 * 60 * 1000;
const CONTEXT_KINDS: readonly ContextFactKind[] = ["feed", "sleep", "diaper"];

export async function getOverview({
  deps,
  actorUserId,
  childId,
}: {
  deps: ServiceDeps;
  actorUserId: string;
  childId: string;
}): Promise<OverviewDto> {
  const workspaceId = await resolveChildWorkspace({ deps, actorUserId, childId });
  const now = deps.now();
  // The dashboard decrypts a dozen rows under one key; resolve it once for the whole projection.
  const scoped: ServiceDeps = { ...deps, keys: withRequestKeyCache(deps.keys) };

  return withTenantTransaction(scoped.db, { workspaceId }, async (tx) => {
    const authorized = await authorizeChild(tx, { userId: actorUserId, workspaceId, childId });
    const metadata = await overviewRepository.readOverviewMetadata(tx, {
      workspaceId,
      childId,
      userId: actorUserId,
    });
    if (metadata === null) throw ApiHttpError.notFound("That child is not available");

    const profile = await decryptChildProfile(scoped.keys, {
      workspaceId,
      childId,
      envelope: authorized.child.profileCiphertext,
    });
    const recentRows = await eventsRepository.listEventsForChild(tx, {
      workspaceId,
      childId,
      cursor: null,
      limit: RECENT_ACTIVITY_LIMIT,
    });

    return {
      child: {
        id: authorized.child.id,
        workspaceId,
        name: profile.name,
        birthdate: profile.birthdate,
        status: authorized.child.status,
        permission: authorized.permission,
        version: authorized.child.version,
      },
      latest: {
        feed: await readLatestFact(tx, scoped, { workspaceId, childId, kind: "feed" }),
        sleep: await readLatestFact(tx, scoped, { workspaceId, childId, kind: "sleep" }),
        diaper: await readLatestFact(tx, scoped, { workspaceId, childId, kind: "diaper" }),
      },
      recentUnknownTime: await readRecentUnknownTime(tx, scoped, {
        workspaceId,
        childId,
        since: new Date(now.getTime() - UNKNOWN_TIME_WINDOW_MS),
      }),
      recentActivity: await Promise.all(recentRows.map((row) => toPreviewDto(scoped, row))),
      activeSessions: await toCareSessionDtos(tx, scoped, metadata.activeSessions),
      // Caller specific, and derived from the journal counter rather than occurrence times.
      unreadChangeCount: Math.max(0, metadata.journalSeq - metadata.acknowledgedSeq),
      pendingCaptureCount: metadata.pendingCaptureCount,
      generatedAt: now.toISOString(),
    };
  });
}

/**
 * Latest known care found across the whole journal, not the first page. The repository already
 * excludes deleted and unknown-time rows; a plan or a question is excluded here, after decrypting
 * the one row that came back.
 */
async function readLatestFact(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  input: { workspaceId: string; childId: string; kind: ContextFactKind },
): Promise<LatestFact | null> {
  const row = await eventsRepository.findLatestConfirmedFactByKind(tx, input);
  if (row === null) return null;
  const fact = await toLatestFact(deps, row, input.kind);
  return fact;
}

/**
 * Reported today with no stated time. These cannot be ranked as the latest occurrence, so they
 * are shown separately instead of replacing a known-time reading.
 */
async function readRecentUnknownTime(
  tx: HandoffTransaction,
  deps: ServiceDeps,
  input: { workspaceId: string; childId: string; since: Date },
): Promise<LatestFact[]> {
  const rows = await eventsRepository.listRecentUnknownTimeEvents(tx, input);
  const facts: LatestFact[] = [];
  for (const row of rows.slice(0, UNKNOWN_TIME_LIMIT)) {
    const kind = CONTEXT_KINDS.find((candidate) => candidate === row.kind);
    if (kind === undefined) continue;
    const fact = await toLatestFact(deps, row, kind);
    if (fact !== null) facts.push(fact);
  }
  return facts;
}

async function toLatestFact(
  deps: ServiceDeps,
  row: EventRow,
  kind: ContextFactKind,
): Promise<LatestFact | null> {
  const payload = await decryptEventPayload(deps.keys, {
    workspaceId: row.workspaceId,
    eventId: row.id,
    envelope: row.payloadCiphertext,
  });
  if (!isCompletedCareFact(row.kind, payload.details)) return null;
  return {
    eventId: row.id,
    revisionId: row.currentRevisionId,
    kind,
    occurredAt: row.occurredAt === null ? null : row.occurredAt.toISOString(),
    endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
    timePrecision: row.timePrecision,
    amountValue: payload.amountValue,
    amountUnit: payload.amountUnit,
    details: payload.details,
    text: renderFactText(
      row.kind,
      {
        occurredAt: row.occurredAt,
        endedAt: row.endedAt,
        timePrecision: row.timePrecision,
        amountValue: payload.amountValue,
        amountUnit: payload.amountUnit,
        details: payload.details,
        reportedAt: row.createdAt,
      },
      row.timezone,
    ),
  };
}

/** The preview carries no source quotes: reading them would cost a revision fetch per row. */
async function toPreviewDto(deps: ServiceDeps, row: EventRow): Promise<EventDto> {
  const payload = await decryptEventPayload(deps.keys, {
    workspaceId: row.workspaceId,
    eventId: row.id,
    envelope: row.payloadCiphertext,
  });
  return toEventDto(row, payload, null);
}
