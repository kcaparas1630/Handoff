import { Directory, File, Paths } from "expo-file-system";

import { recordingExtensionForUri, recordingMimeForUri } from "./lib/recording-mime";
import type { AudioMimeType } from "./types/recorder";

// expo-audio writes into the cache directory, which the system may reclaim. architecture.md
// section 4 requires the file to sit in document storage before anything says it is saved.
const recordingsFolder = "recordings";

export type PersistedRecordingFile = {
  uri: string;
  mime: AudioMimeType;
  sizeBytes: number;
};

function recordingsDirectory(): Directory {
  const directory = new Directory(Paths.document, recordingsFolder);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/**
 * Moves the stopped recording under `recordings/<captureLocalId>.<ext>`. Rejects a container the
 * API would not accept rather than uploading it under a guessed content type.
 */
export async function persistRecording(
  sourceUri: string,
  captureLocalId: string,
): Promise<PersistedRecordingFile> {
  const extension = recordingExtensionForUri(sourceUri);
  const mime = recordingMimeForUri(sourceUri);
  if (extension === null || mime === null) {
    throw new Error("This device recorded an audio format Handoff cannot send.");
  }

  const source = new File(sourceUri);
  if (!source.exists) throw new Error("The recording file is no longer on this device.");

  const destination = new File(recordingsDirectory(), `${captureLocalId}${extension}`);
  // Overwrite so a repeated stop for the same local id cannot leave two partial files behind.
  await source.move(destination, { overwrite: true });

  const stored = new File(destination.uri);
  return { uri: stored.uri, mime, sizeBytes: stored.size };
}

/** Removes a local recording. Missing files are not an error: the outbox may already have won. */
export function deleteRecordingFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A file that cannot be removed must not stop sign-out or outbox cleanup from continuing.
  }
}
