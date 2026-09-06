// Server-side normalization of a validated photo. The client is asked to shrink images before it
// uploads, but the published bytes are the ones produced here (architecture §6): one predictable
// format, a bounded pixel count, and no camera metadata.
import sharp from "sharp";

/** Long edge of a published photo. Above this the file cost outweighs anything a phone shows. */
export const NORMALIZED_MAX_EDGE = 2048;

/** Visually indistinguishable from the source at these sizes, at roughly a fifth of the bytes. */
const JPEG_QUALITY = 85;

export const NORMALIZED_MIME = "image/jpeg";

export interface NormalizedImage {
  bytes: Buffer;
  mime: typeof NORMALIZED_MIME;
  width: number;
  height: number;
}

/**
 * `rotate()` with no argument bakes in the EXIF orientation, so the stored pixels are upright and
 * no viewer has to interpret a tag. sharp drops EXIF, XMP, and ICC unless `withMetadata` or
 * `withExif` asks for them, which is what removes the camera's GPS coordinates; the media
 * lifecycle test asserts that on the output rather than trusting this comment.
 */
export async function normalizeImage(bytes: Buffer): Promise<NormalizedImage> {
  const { data, info } = await sharp(bytes)
    .rotate()
    .resize({
      width: NORMALIZED_MAX_EDGE,
      height: NORMALIZED_MAX_EDGE,
      fit: "inside",
      // A small photo is published at its own size rather than upscaled into a bigger file.
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return { bytes: data, mime: NORMALIZED_MIME, width: info.width, height: info.height };
}
