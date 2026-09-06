// Canonical, versioned context encoding bound into AES-GCM AAD and key-service context.
import type {
  DataKeyPurpose,
  EncryptionScope,
  RecordContext,
  WrappingContext,
} from "../../../types/encryption";

const APPLICATION_ID = "handoff";
const ADDITIONAL_DATA_VERSION = "handoff.aad.v1";
const WRAPPING_AAD_VERSION = "handoff.wrap.v1";

/**
 * Length-prefixed UTF-8 concatenation so no two different field lists share an encoding.
 * Composite row keys ["a","b"] must never encode the same bytes as ["ab"].
 */
export function encodeCanonicalFields(fields: readonly string[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    const bytes = Buffer.from(field, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
}

function scopeIdentifier(scope: EncryptionScope): string {
  return scope.kind === "workspace" ? scope.workspaceId : scope.userId;
}

/**
 * AAD for a single encrypted column. A copied ciphertext fails in another row, column,
 * table, or scope. Never include names, emails, `updated_at`, or the entity version.
 */
export function encodeAdditionalData(input: {
  scope: EncryptionScope;
  record: RecordContext;
  formatVersion: number;
  keyId: string;
}): Buffer {
  const rowIdParts = Array.isArray(input.record.rowId) ? input.record.rowId : [input.record.rowId];
  return encodeCanonicalFields([
    ADDITIONAL_DATA_VERSION,
    APPLICATION_ID,
    input.scope.kind,
    scopeIdentifier(input.scope),
    input.record.table,
    String(rowIdParts.length),
    ...rowIdParts,
    input.record.column,
    String(input.formatVersion),
    input.keyId,
  ]);
}

/** Key-service encryption context. It may appear in audit records, so it carries no PII. */
export function encodeWrappingContext(input: {
  scope: EncryptionScope;
  purpose: DataKeyPurpose;
  contextVersion: number;
}): Record<string, string> {
  return {
    application: APPLICATION_ID,
    scopeKind: input.scope.kind,
    scopeId: scopeIdentifier(input.scope),
    purpose: input.purpose,
    contextVersion: String(input.contextVersion),
  };
}

/** The same binding as `encodeWrappingContext`, as bytes, for wrappers that use AAD. */
export function encodeWrappingContextAad(context: WrappingContext): Buffer {
  const entries = Object.entries(encodeWrappingContext(context)).sort(([a], [b]) =>
    a < b ? -1 : 1,
  );
  return encodeCanonicalFields([WRAPPING_AAD_VERSION, ...entries.flat()]);
}
