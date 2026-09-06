import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalizeEmail,
  computeInvitationLookupHash,
  computeRequestFingerprint,
} from "./invitation-lookup";

const lookupKey = randomBytes(32);
const workspaceA = "11111111-1111-4111-8111-111111111111";
const workspaceB = "22222222-2222-4222-8222-222222222222";

describe("canonicalizeEmail", () => {
  it.each([
    ["  Parent@Example.COM  ", "parent@example.com"],
    ["\tparent@example.com\n", "parent@example.com"],
    ["PARENT@EXAMPLE.COM", "parent@example.com"],
  ])("normalizes %j", (input, expected) => {
    expect(canonicalizeEmail(input)).toBe(expected);
  });

  it("does not strip dots or subaddresses", () => {
    expect(canonicalizeEmail("first.last+daycare@example.com")).toBe(
      "first.last+daycare@example.com",
    );
  });
});

describe("computeInvitationLookupHash", () => {
  it("produces a 256-bit value that ignores case and surrounding whitespace", () => {
    const plain = computeInvitationLookupHash({
      lookupKey,
      workspaceId: workspaceA,
      email: "parent@example.com",
    });
    const noisy = computeInvitationLookupHash({
      lookupKey,
      workspaceId: workspaceA,
      email: " Parent@Example.com ",
    });

    expect(plain).toHaveLength(32);
    expect(plain.equals(noisy)).toBe(true);
  });

  it("separates the same email in two workspaces", () => {
    const inA = computeInvitationLookupHash({
      lookupKey,
      workspaceId: workspaceA,
      email: "parent@example.com",
    });
    const inB = computeInvitationLookupHash({
      lookupKey,
      workspaceId: workspaceB,
      email: "parent@example.com",
    });

    expect(inA.equals(inB)).toBe(false);
  });

  it("changes with the lookup key", () => {
    const withOtherKey = computeInvitationLookupHash({
      lookupKey: randomBytes(32),
      workspaceId: workspaceA,
      email: "parent@example.com",
    });
    const withKey = computeInvitationLookupHash({
      lookupKey,
      workspaceId: workspaceA,
      email: "parent@example.com",
    });

    expect(withKey.equals(withOtherKey)).toBe(false);
  });

  it("rejects a lookup key that is not 256 bits", () => {
    expect(() =>
      computeInvitationLookupHash({
        lookupKey: randomBytes(16),
        workspaceId: workspaceA,
        email: "a@example.com",
      }),
    ).toThrowError(/invalid_key/);
  });
});

describe("computeRequestFingerprint", () => {
  it("differs from an invitation hash over the same field values", () => {
    const invitation = computeInvitationLookupHash({
      lookupKey,
      workspaceId: workspaceA,
      email: "parent@example.com",
    });
    const fingerprint = computeRequestFingerprint({
      lookupKey,
      actorUserId: workspaceA,
      operation: "parent@example.com",
      body: "",
    });

    expect(invitation.equals(fingerprint)).toBe(false);
  });

  it("changes with the request body", () => {
    const first = computeRequestFingerprint({
      lookupKey,
      actorUserId: "user-1",
      operation: "createChild",
      body: "{}",
    });
    const second = computeRequestFingerprint({
      lookupKey,
      actorUserId: "user-1",
      operation: "createChild",
      body: '{"a":1}',
    });

    expect(first.equals(second)).toBe(false);
  });
});
