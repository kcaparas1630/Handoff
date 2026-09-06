import { describe, expect, it } from "vitest";
import {
  assetIdFromObjectKey,
  buildNormalizedImageKey,
  buildObjectKey,
  objectExtensionForMime,
  workspaceObjectPrefix,
} from "./object-key";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const CAPTURE = "33333333-3333-4333-8333-333333333333";
const ASSET = "44444444-4444-4444-8444-444444444444";

describe("buildObjectKey", () => {
  it("names the object by ids only, never by anything the caregiver typed", () => {
    const key = buildObjectKey({
      workspaceId: WORKSPACE,
      childId: CHILD,
      captureId: CAPTURE,
      assetId: ASSET,
      mime: "audio/m4a",
    });
    expect(key).toBe(`${WORKSPACE}/${CHILD}/${CAPTURE}/${ASSET}.m4a`);
  });

  it("refuses an id that is not a UUID, so no caller can shape a path", () => {
    expect(() =>
      buildObjectKey({
        workspaceId: "../other-tenant",
        childId: CHILD,
        captureId: CAPTURE,
        assetId: ASSET,
        mime: "audio/m4a",
      }),
    ).toThrow();
  });

  it("refuses a content type outside the product allowlist", () => {
    expect(() =>
      buildObjectKey({
        workspaceId: WORKSPACE,
        childId: CHILD,
        captureId: CAPTURE,
        assetId: ASSET,
        mime: "application/zip",
      }),
    ).toThrow();
  });
});

describe("objectExtensionForMime", () => {
  it("maps every allowed recording format", () => {
    expect(objectExtensionForMime("audio/mp4")).toBe("m4a");
    expect(objectExtensionForMime("audio/wav")).toBe("wav");
    expect(objectExtensionForMime("audio/webm")).toBe("webm");
  });

  it("returns null rather than guessing", () => {
    expect(objectExtensionForMime("audio/ogg")).toBeNull();
    expect(objectExtensionForMime("")).toBeNull();
  });
});

describe("buildNormalizedImageKey", () => {
  it("does not collide with the raw upload it replaces, even for a JPEG", () => {
    const parts = {
      workspaceId: WORKSPACE,
      childId: CHILD,
      captureId: CAPTURE,
      assetId: ASSET,
    };
    const raw = buildObjectKey({ ...parts, mime: "image/jpeg" });
    const normalized = buildNormalizedImageKey(parts);
    expect(normalized).toBe(`${WORKSPACE}/${CHILD}/${CAPTURE}/${ASSET}.normalized.jpg`);
    expect(normalized).not.toBe(raw);
  });
});

describe("assetIdFromObjectKey", () => {
  it("recovers the asset id from either key this server generates", () => {
    const parts = { workspaceId: WORKSPACE, childId: CHILD, captureId: CAPTURE, assetId: ASSET };
    expect(assetIdFromObjectKey(buildObjectKey({ ...parts, mime: "image/png" }))).toBe(ASSET);
    expect(assetIdFromObjectKey(buildNormalizedImageKey(parts))).toBe(ASSET);
  });

  it("returns null for a key this server did not build", () => {
    expect(assetIdFromObjectKey("stray-object.jpg")).toBeNull();
    expect(assetIdFromObjectKey(`${WORKSPACE}/${CHILD}/${CAPTURE}/not-a-uuid.jpg`)).toBeNull();
  });
});

describe("workspaceObjectPrefix", () => {
  it("ends in a separator so it cannot match a neighbouring workspace id", () => {
    expect(workspaceObjectPrefix(WORKSPACE)).toBe(`${WORKSPACE}/`);
    expect(() => workspaceObjectPrefix("..")).toThrow();
  });
});
