import { describe, expect, it } from "vitest";

import {
  attachmentExtensionForMime,
  attachmentExtensionForUri,
  attachmentMimeFor,
} from "./attachment-mime";

describe("attachmentExtensionForUri", () => {
  it("lower-cases the extension and ignores a query string", () => {
    expect(attachmentExtensionForUri("file:///tmp/IMG_0001.JPEG?x=1")).toBe(".jpeg");
  });

  it("returns null when the path has no extension", () => {
    expect(attachmentExtensionForUri("content://media/external/images/42")).toBeNull();
  });
});

describe("attachmentMimeFor", () => {
  it("keeps an accepted reported type, ignoring the charset suffix", () => {
    const mime = attachmentMimeFor({ kind: "image", reportedMime: "image/png; q=1", uri: "a.png" });
    expect(mime).toBe("image/png");
  });

  it("falls back to the extension when the device reports nothing", () => {
    expect(attachmentMimeFor({ kind: "video", uri: "file:///c/clip.MOV" })).toBe("video/quicktime");
  });

  it("refuses a type that does not belong to the chosen kind", () => {
    const mime = attachmentMimeFor({ kind: "image", reportedMime: "video/mp4", uri: "clip.mp4" });
    expect(mime).toBeNull();
  });

  it("refuses an unsupported container outright", () => {
    expect(attachmentMimeFor({ kind: "video", uri: "file:///c/clip.avi" })).toBeNull();
  });
});

describe("attachmentExtensionForMime", () => {
  it("maps each accepted type to the extension it is stored under", () => {
    expect(attachmentExtensionForMime("image/jpeg")).toBe(".jpg");
    expect(attachmentExtensionForMime("video/quicktime")).toBe(".mov");
    expect(attachmentExtensionForMime("application/pdf")).toBeNull();
  });
});
