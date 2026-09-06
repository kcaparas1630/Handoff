import type {
  BriefContextFact,
  BriefEntry,
  BriefEntryLabel,
  BriefSnapshot,
  ContextFactKind,
  RevisionSnapshot,
} from "@handoff/contracts";
import type { LatestKnownFact, RenderBriefInput, RevisionForBrief } from "../types/brief";
import { renderAgeLabel, renderFactText } from "./fact-text";

const RENDERER_VERSION = "template-v1";
const FIRST_HANDOFF_LABEL = "First handoff \u2014 recent history (24 hours)";
const SINCE_LAST_HANDOFF_LABEL = "Since your last handoff";
const CONTEXT_KINDS: readonly ContextFactKind[] = ["feed", "sleep", "diaper"];

// Pure template rendering of one recipient's change window. Every line it emits cites the
// revision it came from, and nothing outside the boundary can reach the output.
export function renderBrief(input: RenderBriefInput): BriefSnapshot {
  const { boundary, timezone } = input;
  const windowRevisions = [...input.revisions]
    .filter(
      (revision) =>
        revision.journalSeq > boundary.fromSeqExclusive &&
        revision.journalSeq <= boundary.throughSeqInclusive,
    )
    .sort((a, b) => a.journalSeq - b.journalSeq);

  const byEvent = new Map<string, RevisionForBrief[]>();
  for (const revision of windowRevisions) {
    const group = byEvent.get(revision.eventId);
    if (group === undefined) byEvent.set(revision.eventId, [revision]);
    else group.push(revision);
  }

  const updates: RankedEntry[] = [];
  const moments: RankedEntry[] = [];
  for (const group of byEvent.values()) {
    const ranked = collapseEventGroup(group, timezone);
    if (ranked === null) continue;
    if (ranked.entry.kind === "milestone") moments.push(ranked);
    else updates.push(ranked);
  }

  return {
    schemaVersion: 1,
    rendererVersion: RENDERER_VERSION,
    boundary: {
      fromSeqExclusive: boundary.fromSeqExclusive,
      throughSeqInclusive: boundary.throughSeqInclusive,
      initialWindowStart:
        boundary.initialWindowStart === null ? null : boundary.initialWindowStart.toISOString(),
      label: boundary.initialWindowStart === null ? SINCE_LAST_HANDOFF_LABEL : FIRST_HANDOFF_LABEL,
    },
    essentials: renderEssentials(input),
    updates: sortEntries(updates),
    moments: sortEntries(moments),
    pendingCaptureCount: input.pendingCaptureCount,
    // Every revision in the window, including the ones collapsed away, stays traceable.
    sourceRevisionIds: windowRevisions.map((revision) => revision.revisionId),
    generatedAt: input.now.toISOString(),
  };
}

type RankedEntry = {
  entry: BriefEntry;
  journalSeq: number;
};

// Repeated edits of one event become a single entry showing its final values in the window.
function collapseEventGroup(group: RevisionForBrief[], timezone: string): RankedEntry | null {
  const first = group[0];
  const last = group[group.length - 1];
  if (first === undefined || last === undefined) return null;
  const event = last.snapshot.event;
  return {
    journalSeq: last.journalSeq,
    entry: {
      eventId: last.eventId,
      revisionId: last.revisionId,
      kind: event.kind,
      label: resolveLabel(first.operation, last.operation),
      text: renderSnapshotText(last.snapshot, last.createdAt, timezone),
      occurredAt: event.occurredAt,
      timePrecision: event.timePrecision,
      // When the change was published, which is not when the care happened.
      reportedAt: last.createdAt.toISOString(),
      authorDisplayName: last.actorDisplayName,
      important: event.important,
      readyAssetIds: last.snapshot.readyAssetIds,
    },
  };
}

// A create followed by a correction is still shown as "updated" so the reader sees that the
// values moved; only an untouched create reads as new, and any deletion wins outright.
function resolveLabel(
  firstOperation: RevisionForBrief["operation"],
  lastOperation: RevisionForBrief["operation"],
): BriefEntryLabel {
  if (lastOperation === "deleted") return "removed";
  if (firstOperation === "created" && lastOperation === "created") return "new";
  return "updated";
}

function renderSnapshotText(
  snapshot: RevisionSnapshot,
  reportedAt: Date,
  timezone: string,
): string {
  const event = snapshot.event;
  return renderFactText(
    event.kind,
    {
      occurredAt: event.occurredAt === null ? null : new Date(event.occurredAt),
      endedAt: event.endedAt === null ? null : new Date(event.endedAt),
      timePrecision: event.timePrecision,
      amountValue: event.amountValue,
      amountUnit: event.amountUnit,
      details: event.details,
      reportedAt,
    },
    timezone,
  );
}

// Important entries lead the section; the rest stay in publication order.
function sortEntries(ranked: RankedEntry[]): BriefEntry[] {
  return [...ranked]
    .sort((a, b) => {
      if (a.entry.important !== b.entry.important) return a.entry.important ? -1 : 1;
      return a.journalSeq - b.journalSeq;
    })
    .map((item) => item.entry);
}

function renderEssentials(input: RenderBriefInput): BriefContextFact[] {
  const facts: BriefContextFact[] = [];
  for (const kind of CONTEXT_KINDS) {
    const known = input.latestKnown[kind];
    if (known === undefined) continue;
    const fact = renderContextFact(kind, known, input);
    if (fact !== null) facts.push(fact);
  }
  return facts;
}

function renderContextFact(
  kind: ContextFactKind,
  known: LatestKnownFact,
  input: RenderBriefInput,
): BriefContextFact | null {
  const event = known.snapshot.event;
  // A deleted or mismatched record is not latest-known care, whatever the query returned.
  if (event.status === "deleted" || event.kind !== kind) return null;
  const occurredAt = event.occurredAt === null ? null : new Date(event.occurredAt);
  return {
    kind,
    eventId: known.eventId,
    revisionId: known.revisionId,
    text: renderSnapshotText(known.snapshot, known.createdAt, input.timezone),
    occurredAt: event.occurredAt,
    timePrecision: event.timePrecision,
    ageLabel: renderAgeLabel(occurredAt, input.now, input.timezone),
    // Context older than the window is labeled, not counted as one of this brief's updates.
    precedesWindow: known.journalSeq <= input.boundary.fromSeqExclusive,
  };
}
