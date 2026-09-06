import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { saveAttachmentFile } from "./attachment-storage";
import { resizeTargetForImage } from "./lib/resize-target";
import type { PreparedImage } from "./types/attachment";

// architecture.md section 6: resize before upload and strip image location metadata.
const jpegQuality = 0.85;

/**
 * Rewrites a chosen photo as a resized JPEG in this app's document storage. The manipulator
 * re-encodes the pixels and writes a fresh file, so the result carries no EXIF block and therefore
 * no GPS tags; the server strips metadata again authoritatively before publishing.
 */
export async function prepareImageForUpload(
  sourceUri: string,
  localId: string,
): Promise<PreparedImage> {
  // Rendering once without actions is what reveals the source dimensions; only then can the right
  // edge be constrained instead of distorting the picture.
  const source = await ImageManipulator.manipulate(sourceUri).renderAsync();
  const target = resizeTargetForImage(source.width, source.height);
  const rendered =
    target === null
      ? source
      : await ImageManipulator.manipulate(source).resize(target).renderAsync();

  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: jpegQuality });
  const stored = await saveAttachmentFile(saved.uri, localId, ".jpg");

  return {
    uri: stored.uri,
    mime: "image/jpeg",
    sizeBytes: stored.sizeBytes,
    width: rendered.width,
    height: rendered.height,
  };
}
