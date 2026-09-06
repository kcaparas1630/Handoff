// Reads the declared duration of an ISO base media file (MP4/QuickTime) from its container boxes.
// Pure: it is handed bytes and returns numbers. It walks `ftyp` for the brand, then the top-level
// box list to `moov` -> `mvhd`, which carries the timescale and duration of the whole movie.
//
// This inspects the container only. It does not decode video, so it cannot tell whether the
// contained track uses a codec a phone can play (see docs/runbook.md).

const HEADER_BYTES = 8;
/** A 64-bit `largesize` follows the header when `size` is 1. */
const LARGE_SIZE_BYTES = 8;
const MVHD_V0_DURATION_OFFSET = 16;
const MVHD_V1_DURATION_OFFSET = 24;

/** Brands the product accepts: MP4 variants and the QuickTime brand iOS records with. */
const ALLOWED_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "qt  ",
  "M4V ",
  "mmp4",
]);

export type Mp4Inspection =
  | { ok: true; durationMs: number; brand: string }
  | { ok: false; reason: "not_a_container" | "unsupported_brand" | "no_moov" | "corrupt" };

interface BoxHeader {
  type: string;
  /** Offset of the box payload, past the size/type header and any 64-bit largesize. */
  contentStart: number;
  /** Offset one past the box, or the end of the buffer for a box that runs to the end. */
  end: number;
}

/**
 * Reads one box header at `offset`. Returns null when the remaining bytes cannot hold a box or
 * the declared size is inconsistent, which is what a truncated or non-container file looks like.
 */
function readBoxHeader(bytes: Buffer, offset: number, limit: number): BoxHeader | null {
  if (offset + HEADER_BYTES > limit) return null;
  const declared = bytes.readUInt32BE(offset);
  const type = bytes.toString("latin1", offset + 4, offset + HEADER_BYTES);
  if (declared === 1) {
    if (offset + HEADER_BYTES + LARGE_SIZE_BYTES > limit) return null;
    const large = bytes.readBigUInt64BE(offset + HEADER_BYTES);
    const end = offset + Number(large);
    if (large < BigInt(HEADER_BYTES + LARGE_SIZE_BYTES) || end > limit) return null;
    return { type, contentStart: offset + HEADER_BYTES + LARGE_SIZE_BYTES, end };
  }
  // Size 0 means the box runs to the end of the file, which is legal for the last one.
  const end = declared === 0 ? limit : offset + declared;
  if (declared !== 0 && (declared < HEADER_BYTES || end > limit)) return null;
  return { type, contentStart: offset + HEADER_BYTES, end };
}

function findBox(bytes: Buffer, start: number, limit: number, type: string): BoxHeader | null {
  let offset = start;
  while (offset < limit) {
    const header = readBoxHeader(bytes, offset, limit);
    if (header === null) return null;
    if (header.type === type) return header;
    if (header.end <= offset) return null;
    offset = header.end;
  }
  return null;
}

/** `mvhd` version 0 stores 32-bit timescale and duration; version 1 stores 64-bit duration. */
function readMovieDurationMs(bytes: Buffer, mvhd: BoxHeader): number | null {
  const start = mvhd.contentStart;
  if (start + 4 > mvhd.end) return null;
  const version = bytes.readUInt8(start);
  if (version === 0) {
    if (start + MVHD_V0_DURATION_OFFSET + 4 > mvhd.end) return null;
    const timescale = bytes.readUInt32BE(start + 12);
    const duration = bytes.readUInt32BE(start + MVHD_V0_DURATION_OFFSET);
    if (timescale === 0) return null;
    return Math.round((duration / timescale) * 1000);
  }
  if (version === 1) {
    if (start + MVHD_V1_DURATION_OFFSET + 8 > mvhd.end) return null;
    const timescale = bytes.readUInt32BE(start + 20);
    const duration = bytes.readBigUInt64BE(start + MVHD_V1_DURATION_OFFSET);
    if (timescale === 0) return null;
    return Math.round((Number(duration) / timescale) * 1000);
  }
  return null;
}

/**
 * The whole inspection: it is a container, its brand is one we accept, and it declares a movie
 * duration. A file with no `moov` is reported separately from one that is not a container at all,
 * because a fragmented upload that never finished looks like the former.
 */
export function inspectMp4Container(bytes: Buffer): Mp4Inspection {
  const limit = bytes.byteLength;
  const ftyp = readBoxHeader(bytes, 0, limit);
  if (ftyp === null || ftyp.type !== "ftyp") return { ok: false, reason: "not_a_container" };
  if (ftyp.contentStart + 4 > ftyp.end) return { ok: false, reason: "corrupt" };

  const brand = bytes.toString("latin1", ftyp.contentStart, ftyp.contentStart + 4);
  if (!ALLOWED_BRANDS.has(brand)) return { ok: false, reason: "unsupported_brand" };

  const moov = findBox(bytes, ftyp.end, limit, "moov");
  if (moov === null) return { ok: false, reason: "no_moov" };
  const mvhd = findBox(bytes, moov.contentStart, moov.end, "mvhd");
  if (mvhd === null) return { ok: false, reason: "no_moov" };

  const durationMs = readMovieDurationMs(bytes, mvhd);
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return { ok: false, reason: "corrupt" };
  }
  return { ok: true, durationMs, brand };
}
