import { describe, expect, it } from "vitest";

import {
  isSupportedAudioMime,
  recordingExtensionForUri,
  recordingMimeForUri,
} from "./recording-mime";

describe("recordingMimeForUri", () => {
  it("maps the containers expo-audio produces on iOS and Android", () => {
    expect(recordingMimeForUri("file:///tmp/recording-1.m4a")).toBe("audio/m4a");
    expect(recordingMimeForUri("file:///tmp/recording-1.WAV")).toBe("audio/wav");
    expect(recordingMimeForUri("file:///tmp/clip.webm")).toBe("audio/webm");
  });

  it("refuses to guess a content type it does not support", () => {
    expect(recordingMimeForUri("file:///tmp/recording.caf")).toBeNull();
    expect(recordingMimeForUri("file:///tmp/recording.3gp")).toBeNull();
    expect(recordingMimeForUri("file:///tmp/recording")).toBeNull();
  });
});

describe("recordingExtensionForUri", () => {
  it("returns the stored suffix in lower case", () => {
    expect(recordingExtensionForUri("file:///tmp/a.M4A")).toBe(".m4a");
  });

  it("returns null for a container the API would reject", () => {
    expect(recordingExtensionForUri("file:///tmp/a.caf")).toBeNull();
  });
});

describe("isSupportedAudioMime", () => {
  it("accepts only the product's audio list", () => {
    expect(isSupportedAudioMime("audio/m4a")).toBe(true);
    expect(isSupportedAudioMime("audio/ogg")).toBe(false);
  });
});
