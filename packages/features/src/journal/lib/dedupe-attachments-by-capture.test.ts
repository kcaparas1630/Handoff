import { describe, expect, it } from "vitest";

import { dedupeAttachmentsByCapture } from "./dedupe-attachments-by-capture";

describe("dedupeAttachmentsByCapture", () => {
  it("returns an empty map for no entries", () => {
    expect(dedupeAttachmentsByCapture([])).toEqual({});
  });

  it("shows one capture's photo on the first entry that carries it", () => {
    const result = dedupeAttachmentsByCapture([
      { key: "feed", readyAssetIds: ["a", "b"] },
      { key: "diaper", readyAssetIds: ["a", "b"] },
    ]);
    expect(result).toEqual({ feed: ["a", "b"], diaper: [] });
  });

  it("keeps a second capture's own attachments visible", () => {
    const result = dedupeAttachmentsByCapture([
      { key: "feed", readyAssetIds: ["a"] },
      { key: "milestone", readyAssetIds: ["z"] },
    ]);
    expect(result).toEqual({ feed: ["a"], milestone: ["z"] });
  });

  it("shows only the ids an entry adds when two captures overlap", () => {
    const result = dedupeAttachmentsByCapture([
      { key: "one", readyAssetIds: ["a"] },
      { key: "two", readyAssetIds: ["a", "b"] },
    ]);
    expect(result).toEqual({ one: ["a"], two: ["b"] });
  });

  it("leaves entries without attachments empty", () => {
    expect(dedupeAttachmentsByCapture([{ key: "note", readyAssetIds: [] }])).toEqual({ note: [] });
  });
});
