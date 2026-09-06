import { Directory, File, Paths } from "expo-file-system";

import type { StoredAttachmentFile } from "./types/attachment";

// The picker and the image manipulator both write into the cache directory, which the system may
// reclaim. Nothing is reported as saved until it sits in document storage.
const attachmentsFolder = "attachments";

function attachmentsDirectory(): Directory {
  const directory = new Directory(Paths.document, attachmentsFolder);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/**
 * Copies a chosen or prepared file to `attachments/<localId><extension>` and reports the stored
 * size. The source copy is left alone: it belongs to the system picker, not to Handoff.
 */
export async function saveAttachmentFile(
  sourceUri: string,
  localId: string,
  extension: string,
): Promise<StoredAttachmentFile> {
  const source = new File(sourceUri);
  if (!source.exists) throw new Error("That file is no longer on this device.");

  const destination = new File(attachmentsDirectory(), `${localId}${extension}`);
  // Overwrite so a repeated pick under the same local id cannot leave two partial files behind.
  await source.copy(destination, { overwrite: true });

  const stored = new File(destination.uri);
  return { uri: stored.uri, sizeBytes: stored.size };
}

/** Removes a stored attachment. A missing file is not an error: the outbox may already have won. */
export function deleteAttachmentFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A file that cannot be removed must not stop sign-out or outbox cleanup from continuing.
  }
}
