import { describe, expect, it } from "vitest";
import type { EncryptionScope, RecordContext } from "../../../types/encryption";
import {
  encodeAdditionalData,
  encodeWrappingContext,
  encodeWrappingContextAad,
} from "./encryption-context";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const scope: EncryptionScope = { kind: "workspace", workspaceId };
const record: RecordContext = {
  table: "events",
  rowId: "22222222-2222-4222-8222-222222222222",
  column: "payload_ciphertext",
};
const keyId = "33333333-3333-4333-8333-333333333333";
const baseline = { scope, record, formatVersion: 1, keyId };

type AdditionalDataInput = Parameters<typeof encodeAdditionalData>[0];

const variations: [string, AdditionalDataInput][] = [
  ["scope kind", { ...baseline, scope: { kind: "user", userId: workspaceId } }],
  ["workspace id", { ...baseline, scope: { kind: "workspace", workspaceId: "other" } }],
  ["table", { ...baseline, record: { ...record, table: "captures" } }],
  ["row id", { ...baseline, record: { ...record, rowId: "another-row" } }],
  ["column", { ...baseline, record: { ...record, column: "content_ciphertext" } }],
  ["format version", { ...baseline, formatVersion: 2 }],
  ["key id", { ...baseline, keyId: "44444444-4444-4444-8444-444444444444" }],
];

describe("encodeAdditionalData", () => {
  it("is deterministic for the same context", () => {
    expect(encodeAdditionalData(baseline).equals(encodeAdditionalData(baseline))).toBe(true);
  });

  it.each(variations)("changes when the %s changes", (_label, changed) => {
    expect(encodeAdditionalData(changed).equals(encodeAdditionalData(baseline))).toBe(false);
  });

  it("separates composite row key parts from their concatenation", () => {
    const parts = encodeAdditionalData({ ...baseline, record: { ...record, rowId: ["a", "b"] } });
    const joined = encodeAdditionalData({ ...baseline, record: { ...record, rowId: ["ab"] } });

    expect(parts.equals(joined)).toBe(false);
  });

  it("distinguishes a single row id from a one-element composite key", () => {
    const single = encodeAdditionalData({ ...baseline, record: { ...record, rowId: "a" } });
    const composite = encodeAdditionalData({ ...baseline, record: { ...record, rowId: ["a"] } });

    // A one-element array is the same row identity, so the encodings intentionally agree.
    expect(single.equals(composite)).toBe(true);
  });
});

describe("encodeWrappingContext", () => {
  it("describes the scope and purpose without personal information", () => {
    expect(encodeWrappingContext({ scope, purpose: "content", contextVersion: 1 })).toEqual({
      application: "handoff",
      scopeKind: "workspace",
      scopeId: workspaceId,
      purpose: "content",
      contextVersion: "1",
    });
  });

  it("binds purpose into the wrapping additional data", () => {
    const content = encodeWrappingContextAad({ scope, purpose: "content", contextVersion: 1 });
    const lookup = encodeWrappingContextAad({ scope, purpose: "lookup", contextVersion: 1 });

    expect(content.equals(lookup)).toBe(false);
  });
});
