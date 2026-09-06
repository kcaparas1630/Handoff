import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptAesGcm, encryptAesGcm } from "./aes-gcm";
import { EncryptionError } from "./errors";
import type { EncryptionErrorCode } from "./errors";

const hex = (value: string) => Buffer.from(value, "hex");

// Test Case 16 from McGrew & Viega, "The Galois/Counter Mode of Operation (GCM)",
// the GCM specification submitted to and published by NIST (AES-256, 96-bit IV, with AAD).
const nistTestCase16 = {
  key: hex("feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308"),
  nonce: hex("cafebabefacedbaddecaf888"),
  additionalData: hex("feedfacedeadbeeffeedfacedeadbeefabaddad2"),
  plaintext: hex(
    "d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39",
  ),
  ciphertext: hex(
    "522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662",
  ),
  tag: hex("76fc6ece0f4e1768cddf8853bb2d551b"),
};

// Test Case 14: AES-256, all-zero key/IV, one zero block, no AAD.
const nistTestCase14 = {
  key: Buffer.alloc(32),
  nonce: Buffer.alloc(12),
  additionalData: Buffer.alloc(0),
  plaintext: Buffer.alloc(16),
  ciphertext: hex("cea7403d4d606b6e074ec5d3baf39d18"),
  tag: hex("d0d1c8a799996bf0265b98b5d48ab919"),
};

function flipBit(bytes: Buffer, index: number): Buffer {
  const copy = Buffer.from(bytes);
  copy.writeUInt8(copy.readUInt8(index) ^ 0x01, index);
  return copy;
}

function expectEncryptionError(run: () => unknown, code: EncryptionErrorCode): void {
  try {
    run();
  } catch (error) {
    if (!(error instanceof EncryptionError)) throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} but nothing was thrown`);
}

describe("aes-gcm", () => {
  it("round trips a payload with its additional data", () => {
    const key = randomBytes(32);
    const additionalData = Buffer.from("row-context", "utf8");
    const plaintext = Buffer.from("a synthetic note", "utf8");

    const parts = encryptAesGcm(plaintext, key, additionalData);

    expect(parts.nonce).toHaveLength(12);
    expect(parts.tag).toHaveLength(16);
    expect(decryptAesGcm(parts, key, additionalData)).toEqual(plaintext);
  });

  it.each([
    ["case 14", nistTestCase14],
    ["case 16", nistTestCase16],
  ])("matches NIST GCM specification %s", (_label, vector) => {
    const plaintext = decryptAesGcm(
      { nonce: vector.nonce, ciphertext: vector.ciphertext, tag: vector.tag },
      vector.key,
      vector.additionalData,
    );

    expect(plaintext.toString("hex")).toBe(vector.plaintext.toString("hex"));
  });

  it("rejects a tampered tag", () => {
    const tag = flipBit(nistTestCase16.tag, 0);
    expectEncryptionError(
      () =>
        decryptAesGcm(
          { nonce: nistTestCase16.nonce, ciphertext: nistTestCase16.ciphertext, tag },
          nistTestCase16.key,
          nistTestCase16.additionalData,
        ),
      "authentication_failed",
    );
  });

  it("rejects tampered ciphertext", () => {
    const ciphertext = flipBit(nistTestCase16.ciphertext, 3);
    expectEncryptionError(
      () =>
        decryptAesGcm(
          { nonce: nistTestCase16.nonce, ciphertext, tag: nistTestCase16.tag },
          nistTestCase16.key,
          nistTestCase16.additionalData,
        ),
      "authentication_failed",
    );
  });

  it("rejects a tampered nonce", () => {
    const nonce = flipBit(nistTestCase16.nonce, 11);
    expectEncryptionError(
      () =>
        decryptAesGcm(
          { nonce, ciphertext: nistTestCase16.ciphertext, tag: nistTestCase16.tag },
          nistTestCase16.key,
          nistTestCase16.additionalData,
        ),
      "authentication_failed",
    );
  });

  it("rejects the wrong additional data", () => {
    expectEncryptionError(
      () =>
        decryptAesGcm(
          {
            nonce: nistTestCase16.nonce,
            ciphertext: nistTestCase16.ciphertext,
            tag: nistTestCase16.tag,
          },
          nistTestCase16.key,
          Buffer.from("feedfacedeadbeeffeedfacedeadbeefabaddad3", "hex"),
        ),
      "authentication_failed",
    );
  });

  it("rejects the wrong key", () => {
    const key = flipBit(nistTestCase16.key, 31);
    expectEncryptionError(
      () =>
        decryptAesGcm(
          {
            nonce: nistTestCase16.nonce,
            ciphertext: nistTestCase16.ciphertext,
            tag: nistTestCase16.tag,
          },
          key,
          nistTestCase16.additionalData,
        ),
      "authentication_failed",
    );
  });

  it("rejects a key that is not 256 bits", () => {
    expectEncryptionError(
      () => encryptAesGcm(Buffer.from("x"), randomBytes(16), Buffer.alloc(0)),
      "invalid_key",
    );
  });

  it("uses a fresh nonce for every encryption of the same plaintext", () => {
    const key = randomBytes(32);
    const additionalData = Buffer.from("row-context", "utf8");
    const plaintext = Buffer.from("identical plaintext", "utf8");

    const first = encryptAesGcm(plaintext, key, additionalData);
    const second = encryptAesGcm(plaintext, key, additionalData);

    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
    expect(first.tag.equals(second.tag)).toBe(false);
  });
});
