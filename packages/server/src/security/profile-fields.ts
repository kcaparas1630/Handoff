// Binds each protected column to its scope, record context, and payload schema.
// Callers must have authorized the row before calling any decrypt function here.
import { decryptField, encryptField } from "./encryption/field-encryption";
import {
  childProfilePayloadSchema,
  inviteePayloadSchema,
  userProfilePayloadSchema,
  workspaceProfilePayloadSchema,
} from "../schemas/profiles";
import {
  childProfileRecord,
  invitationEmailRecord,
  userProfileRecord,
  userScope,
  workspaceProfileRecord,
  workspaceScope,
} from "../lib/record-contexts";
import type { DataKeyService } from "./encryption/data-keys";
import type { CiphertextEnvelope } from "../types/encryption";
import type { ChildProfilePayload } from "../types/profiles";

export function encryptUserProfile(
  keys: DataKeyService,
  userId: string,
  displayName: string | null,
): Promise<CiphertextEnvelope> {
  return encryptField({
    keys,
    scope: userScope(userId),
    record: userProfileRecord(userId),
    payload: { schemaVersion: 1, displayName },
  });
}

export async function decryptUserProfile(
  keys: DataKeyService,
  userId: string,
  envelope: unknown,
): Promise<string | null> {
  const payload = await decryptField({
    keys,
    scope: userScope(userId),
    record: userProfileRecord(userId),
    envelope,
  });
  return userProfilePayloadSchema.parse(payload).displayName;
}

export function encryptWorkspaceProfile(
  keys: DataKeyService,
  workspaceId: string,
  name: string,
): Promise<CiphertextEnvelope> {
  return encryptField({
    keys,
    scope: workspaceScope(workspaceId),
    record: workspaceProfileRecord(workspaceId),
    payload: { schemaVersion: 1, name },
  });
}

export async function decryptWorkspaceProfile(
  keys: DataKeyService,
  workspaceId: string,
  envelope: unknown,
): Promise<string> {
  const payload = await decryptField({
    keys,
    scope: workspaceScope(workspaceId),
    record: workspaceProfileRecord(workspaceId),
    envelope,
  });
  return workspaceProfilePayloadSchema.parse(payload).name;
}

export function encryptChildProfile(
  keys: DataKeyService,
  input: { workspaceId: string; childId: string; name: string; birthdate: string | null },
): Promise<CiphertextEnvelope> {
  return encryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: childProfileRecord(input.childId),
    payload: { schemaVersion: 1, name: input.name, birthdate: input.birthdate },
  });
}

export async function decryptChildProfile(
  keys: DataKeyService,
  input: { workspaceId: string; childId: string; envelope: unknown },
): Promise<ChildProfilePayload> {
  const payload = await decryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: childProfileRecord(input.childId),
    envelope: input.envelope,
  });
  return childProfilePayloadSchema.parse(payload);
}

export function encryptInviteeEmail(
  keys: DataKeyService,
  input: { workspaceId: string; invitationId: string; email: string },
): Promise<CiphertextEnvelope> {
  return encryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: invitationEmailRecord(input.invitationId),
    payload: { schemaVersion: 1, email: input.email },
  });
}

export async function decryptInviteeEmail(
  keys: DataKeyService,
  input: { workspaceId: string; invitationId: string; envelope: unknown },
): Promise<string> {
  const payload = await decryptField({
    keys,
    scope: workspaceScope(input.workspaceId),
    record: invitationEmailRecord(input.invitationId),
    envelope: input.envelope,
  });
  return inviteePayloadSchema.parse(payload).email;
}
