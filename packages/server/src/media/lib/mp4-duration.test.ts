import { describe, expect, it } from "vitest";
import { inspectMp4Container } from "./mp4-duration";

/** `size` + `type` + payload, which is every box in the format. */
function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.byteLength + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

function ftyp(brand: string): Buffer {
  const payload = Buffer.alloc(12);
  payload.write(brand, 0, "latin1");
  payload.writeUInt32BE(512, 4);
  payload.write(brand, 8, "latin1");
  return box("ftyp", payload);
}

/** version 0: 1 version byte, 3 flag bytes, created, modified, timescale, duration. */
function mvhdV0(timescale: number, duration: number): Buffer {
  const payload = Buffer.alloc(100);
  payload.writeUInt8(0, 0);
  payload.writeUInt32BE(timescale, 12);
  payload.writeUInt32BE(duration, 16);
  return box("mvhd", payload);
}

/** version 1: the two times widen to 64 bits, so timescale and duration move on by 8. */
function mvhdV1(timescale: number, duration: bigint): Buffer {
  const payload = Buffer.alloc(112);
  payload.writeUInt8(1, 0);
  payload.writeUInt32BE(timescale, 20);
  payload.writeBigUInt64BE(duration, 24);
  return box("mvhd", payload);
}

function movie(brand: string, mvhd: Buffer, extraTopLevel: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([ftyp(brand), extraTopLevel, box("moov", mvhd)]);
}

describe("inspectMp4Container", () => {
  it("reads a version 0 movie header", () => {
    // 15000 units at 1000 units per second.
    expect(inspectMp4Container(movie("isom", mvhdV0(1_000, 15_000)))).toEqual({
      ok: true,
      durationMs: 15_000,
      brand: "isom",
    });
  });

  it("reads a version 1 movie header with a 64-bit duration", () => {
    expect(inspectMp4Container(movie("mp42", mvhdV1(600, 7_200n)))).toEqual({
      ok: true,
      durationMs: 12_000,
      brand: "mp42",
    });
  });

  it("accepts the QuickTime brand an iPhone records", () => {
    const inspected = inspectMp4Container(movie("qt  ", mvhdV0(30_000, 300_000)));
    expect(inspected).toEqual({ ok: true, durationMs: 10_000, brand: "qt  " });
  });

  it("walks past other top-level boxes to reach moov", () => {
    const mdat = box("mdat", Buffer.alloc(64, 7));
    const inspected = inspectMp4Container(movie("iso4", mvhdV0(1_000, 2_500), mdat));
    expect(inspected).toEqual({ ok: true, durationMs: 2_500, brand: "iso4" });
  });

  it("reports bytes that are not a container", () => {
    expect(inspectMp4Container(Buffer.from("this is plainly not a video", "utf8"))).toEqual({
      ok: false,
      reason: "not_a_container",
    });
    expect(inspectMp4Container(Buffer.alloc(4))).toEqual({ ok: false, reason: "not_a_container" });
  });

  it("refuses a brand outside the allowlist", () => {
    expect(inspectMp4Container(movie("3gp4", mvhdV0(1_000, 1_000)))).toEqual({
      ok: false,
      reason: "unsupported_brand",
    });
  });

  it("reports a file with no movie header", () => {
    const withoutMoov = Buffer.concat([ftyp("isom"), box("mdat", Buffer.alloc(32))]);
    expect(inspectMp4Container(withoutMoov)).toEqual({ ok: false, reason: "no_moov" });
    const emptyMoov = Buffer.concat([ftyp("isom"), box("moov", Buffer.alloc(0))]);
    expect(inspectMp4Container(emptyMoov)).toEqual({ ok: false, reason: "no_moov" });
  });

  it("refuses a zero timescale rather than dividing by it", () => {
    expect(inspectMp4Container(movie("isom", mvhdV0(0, 15_000)))).toEqual({
      ok: false,
      reason: "corrupt",
    });
  });

  it("refuses a box whose declared size runs past the buffer", () => {
    const truncated = Buffer.concat([ftyp("isom"), box("moov", mvhdV0(1_000, 1_000))]);
    // Claim the moov box is far larger than the bytes that follow it.
    truncated.writeUInt32BE(4_096, 20);
    expect(inspectMp4Container(truncated)).toEqual({ ok: false, reason: "no_moov" });
  });
});
