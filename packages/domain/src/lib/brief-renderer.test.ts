import { describe, expect, it } from "vitest";
import type { RevisionEvent, RevisionSnapshot } from "@handoff/contracts";
import { renderBrief } from "./brief-renderer";
import type { LatestKnownFact, RenderBriefInput, RevisionForBrief } from "../types/brief";

const TIMEZONE = "America/Vancouver";
// 11:00 local on 2026-09-06, so the fixtures below sit earlier the same local day.
const NOW = new Date("2026-09-06T18:00:00.000Z");

function snapshot(event: Partial<RevisionEvent> = {}): RevisionSnapshot {
  return {
    schemaVersion: 1,
    event: {
      kind: "feed",
      occurredAt: "2026-09-06T09:00:00.000Z",
      endedAt: null,
      timezone: TIMEZONE,
      timePrecision: "exact",
      amountValue: "60.00",
      amountUnit: "ml",
      details: { kind: "feed", method: "bottle" },
      important: false,
      status: "active",
      ...event,
    },
    sourceQuote: null,
    readyAssetIds: [],
  };
}

function revision(journalSeq: number, overrides: Partial<RevisionForBrief> = {}): RevisionForBrief {
  return {
    revisionId: `rev-${journalSeq}`,
    eventId: `event-${journalSeq}`,
    journalSeq,
    eventVersion: 1,
    operation: "created",
    actorDisplayName: "Alex",
    createdAt: new Date("2026-09-06T21:10:00.000Z"),
    snapshot: snapshot(),
    ...overrides,
  };
}

function render(overrides: Partial<RenderBriefInput> = {}) {
  return renderBrief({
    revisions: [],
    latestKnown: {},
    boundary: { fromSeqExclusive: 4, throughSeqInclusive: 9, initialWindowStart: null },
    pendingCaptureCount: 0,
    now: NOW,
    timezone: TIMEZONE,
    ...overrides,
  });
}

describe("renderBrief entry text", () => {
  it("renders a feed with its amount, unit, method, and time", () => {
    const brief = render({ revisions: [revision(5)] });
    expect(brief.updates[0]?.text).toBe("Fed 60 ml (bottle) at 02:00");
  });

  it("says an amount was not recorded instead of inventing one", () => {
    const brief = render({
      revisions: [revision(5, { snapshot: snapshot({ amountValue: null, amountUnit: null }) })],
    });
    expect(brief.updates[0]?.text).toBe("Fed (bottle, amount not recorded) at 02:00");
  });

  it("reports an unknown occurrence time as reported, not as happened", () => {
    const brief = render({
      revisions: [
        revision(5, {
          snapshot: snapshot({
            occurredAt: null,
            timePrecision: "unknown",
            amountValue: null,
            amountUnit: null,
          }),
        }),
      ],
    });
    expect(brief.updates[0]?.text).toBe(
      "Fed (bottle, amount not recorded), reported 14:10, time not given",
    );
    expect(brief.updates[0]?.occurredAt).toBeNull();
  });

  it("keeps a qualitative diaper quantity in the words that were used", () => {
    const brief = render({
      revisions: [
        revision(5, {
          snapshot: snapshot({
            kind: "diaper",
            occurredAt: "2026-09-06T15:50:00.000Z",
            amountValue: null,
            amountUnit: null,
            details: { kind: "diaper", contents: "stool", quantity: "a lot" },
          }),
        }),
      ],
    });
    expect(brief.updates[0]?.text).toBe("Stool diaper (a lot) at 08:50");
  });

  it("renders a sleep interval as a range", () => {
    const brief = render({
      revisions: [
        revision(5, {
          snapshot: snapshot({
            kind: "sleep",
            occurredAt: "2026-09-06T15:00:00.000Z",
            endedAt: "2026-09-06T15:40:00.000Z",
            amountValue: null,
            amountUnit: null,
            details: { kind: "sleep", state: "interval" },
          }),
        }),
      ],
    });
    expect(brief.updates[0]?.text).toBe("Slept 08:00–08:40");
  });

  it("puts a milestone in moments and preserves the reported quote", () => {
    const brief = render({
      revisions: [
        revision(5, {
          snapshot: snapshot({
            kind: "milestone",
            occurredAt: "2026-09-06T21:10:00.000Z",
            amountValue: null,
            amountUnit: null,
            details: {
              kind: "milestone",
              description: "first word",
              quote: "Dada",
              reportedFirst: true,
            },
          }),
        }),
      ],
    });
    expect(brief.updates).toHaveLength(0);
    expect(brief.moments[0]?.text).toBe(
      "Milestone (reported as a first): first word — “Dada” at 14:10",
    );
  });

  it("never phrases a planned note as care that happened", () => {
    const brief = render({
      revisions: [
        revision(5, {
          snapshot: snapshot({
            kind: "note",
            occurredAt: null,
            timePrecision: "unknown",
            amountValue: null,
            amountUnit: null,
            details: { kind: "note", text: "Give 60 ml later", intent: "planned" },
          }),
        }),
      ],
    });
    const text = brief.updates[0]?.text ?? "";
    expect(text).toBe("Plan: Give 60 ml later");
    expect(text).not.toMatch(/\bfed\b/i);
    expect(text).not.toMatch(/\bat\b/);
  });
});

describe("renderBrief collapsing and boundaries", () => {
  it("collapses a create and a correction of one event into one updated entry", () => {
    const brief = render({
      revisions: [
        revision(5, { revisionId: "rev-a", eventId: "event-1", operation: "created" }),
        revision(6, {
          revisionId: "rev-b",
          eventId: "event-1",
          operation: "corrected",
          eventVersion: 2,
          snapshot: snapshot({ amountValue: "90.00" }),
        }),
      ],
    });
    expect(brief.updates).toHaveLength(1);
    expect(brief.updates[0]?.label).toBe("updated");
    expect(brief.updates[0]?.revisionId).toBe("rev-b");
    expect(brief.updates[0]?.text).toContain("90 ml");
    // Both revisions stay traceable even though only one entry is shown.
    expect(brief.sourceRevisionIds).toEqual(["rev-a", "rev-b"]);
  });

  it("labels an untouched create as new", () => {
    const brief = render({ revisions: [revision(5)] });
    expect(brief.updates[0]?.label).toBe("new");
  });

  it("labels a create followed by a deletion as removed", () => {
    const brief = render({
      revisions: [
        revision(5, { revisionId: "rev-a", eventId: "event-1", operation: "created" }),
        revision(6, {
          revisionId: "rev-b",
          eventId: "event-1",
          operation: "deleted",
          snapshot: snapshot({ status: "deleted" }),
        }),
      ],
    });
    expect(brief.updates).toHaveLength(1);
    expect(brief.updates[0]?.label).toBe("removed");
  });

  it("ignores revisions outside the boundary", () => {
    const brief = render({ revisions: [revision(4), revision(10)] });
    expect(brief.updates).toHaveLength(0);
    expect(brief.sourceRevisionIds).toEqual([]);
  });

  it("renders an empty window with the since-last-handoff label", () => {
    const brief = render();
    expect(brief.updates).toEqual([]);
    expect(brief.moments).toEqual([]);
    expect(brief.boundary.label).toBe("Since your last handoff");
    expect(brief.rendererVersion).toBe("template-v1");
    expect(brief.generatedAt).toBe(NOW.toISOString());
  });

  it("discloses the first-visit window in the boundary label", () => {
    const initialWindowStart = new Date("2026-09-05T18:00:00.000Z");
    const brief = render({
      boundary: { fromSeqExclusive: 0, throughSeqInclusive: 3, initialWindowStart },
    });
    expect(brief.boundary.label).toBe("First handoff — recent history (24 hours)");
    expect(brief.boundary.initialWindowStart).toBe(initialWindowStart.toISOString());
  });

  it("leads with important entries and cites a revision on every entry", () => {
    const brief = render({
      revisions: [
        revision(5, { revisionId: "rev-plain", eventId: "event-1" }),
        revision(6, {
          revisionId: "rev-important",
          eventId: "event-2",
          snapshot: snapshot({ important: true }),
        }),
      ],
      pendingCaptureCount: 2,
    });
    expect(brief.updates.map((entry) => entry.revisionId)).toEqual(["rev-important", "rev-plain"]);
    for (const entry of [...brief.updates, ...brief.moments]) {
      expect(entry.revisionId).not.toBe("");
      expect(entry.eventId).not.toBe("");
      expect(entry.reportedAt).toBe("2026-09-06T21:10:00.000Z");
      expect(entry.authorDisplayName).toBe("Alex");
    }
    expect(brief.pendingCaptureCount).toBe(2);
  });
});

describe("renderBrief essentials", () => {
  function latest(overrides: Partial<LatestKnownFact> = {}): LatestKnownFact {
    return {
      eventId: "event-old",
      revisionId: "rev-old",
      journalSeq: 2,
      createdAt: new Date("2026-09-06T09:05:00.000Z"),
      snapshot: snapshot(),
      ...overrides,
    };
  }

  it("labels latest-known care that precedes the window and ages it", () => {
    const brief = render({ latestKnown: { feed: latest() } });
    expect(brief.essentials).toHaveLength(1);
    expect(brief.essentials[0]).toMatchObject({
      kind: "feed",
      eventId: "event-old",
      revisionId: "rev-old",
      text: "Fed 60 ml (bottle) at 02:00",
      ageLabel: "9 h ago",
      precedesWindow: true,
    });
  });

  it("does not mark context inside the window as preceding it", () => {
    const brief = render({ latestKnown: { feed: latest({ journalSeq: 7 }) } });
    expect(brief.essentials[0]?.precedesWindow).toBe(false);
  });

  it("drops a deleted or mismatched latest-known record", () => {
    const deleted = render({
      latestKnown: { feed: latest({ snapshot: snapshot({ status: "deleted" }) }) },
    });
    expect(deleted.essentials).toEqual([]);
    const mismatched = render({ latestKnown: { diaper: latest() } });
    expect(mismatched.essentials).toEqual([]);
  });

  it("says the time was not given when the latest fact cannot be ranked", () => {
    const brief = render({
      latestKnown: {
        feed: latest({ snapshot: snapshot({ occurredAt: null, timePrecision: "unknown" }) }),
      },
    });
    expect(brief.essentials[0]?.ageLabel).toBe("time not given");
    expect(brief.essentials[0]?.text).toContain("time not given");
  });
});
