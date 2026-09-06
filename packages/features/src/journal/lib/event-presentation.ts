import type { EventDto } from "@handoff/contracts";
import { formatWallClock, renderAgeLabel, renderFactText } from "@handoff/domain";
import type { EventCardTag } from "@handoff/ui";

export type EventPresentation = {
  factText: string;
  /** One line covering when the care happened and when it was reported. */
  timeLine: string;
  authorLabel: string;
  tag?: EventCardTag;
};

/**
 * Renders one confirmed event for a card, reusing the same deterministic templates the brief uses.
 * Attribution is limited to "you" or "another caregiver" because the event DTO carries user ids
 * rather than names; the handoff brief is where authored names are published.
 */
export function presentEvent(
  event: EventDto,
  now: Date,
  ownUserId: string | null,
): EventPresentation {
  const occurredAt = event.occurredAt === null ? null : new Date(event.occurredAt);
  const reportedAt = new Date(event.createdAt);
  const factText = renderFactText(
    event.kind,
    {
      occurredAt,
      endedAt: event.endedAt === null ? null : new Date(event.endedAt),
      timePrecision: event.timePrecision,
      amountValue: event.amountValue,
      amountUnit: event.amountUnit,
      details: event.details,
      reportedAt,
    },
    event.timezone,
  );

  const happened =
    occurredAt === null
      ? "Time not given"
      : `Happened ${renderAgeLabel(occurredAt, now, event.timezone)}`;
  const timeLine = `${happened} · reported ${formatWallClock(reportedAt, event.timezone)}`;

  const presentation: EventPresentation = {
    factText,
    timeLine,
    authorLabel:
      event.createdByUserId === ownUserId ? "Recorded by you" : "Recorded by another caregiver",
  };
  const tag = resolveTag(event);
  return tag === undefined ? presentation : { ...presentation, tag };
}

function resolveTag(event: EventDto): EventCardTag | undefined {
  if (event.status === "deleted") return "removed";
  // The first published revision is version 1; anything higher went through a correction.
  return event.version > 1 ? "updated" : undefined;
}
