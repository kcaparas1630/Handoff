import { describe, expect, it } from "vitest";
import { inviteeEmailSchema } from "./invitations";

// The server derives the invitation lookup HMAC from this output, so the canonical form is load-bearing.
describe("invitee email canonicalization", () => {
  it("trims and lowercases before the address is accepted", () => {
    expect(inviteeEmailSchema.parse("  Parent.One@Example.COM ")).toBe("parent.one@example.com");
  });

  it("rejects text that is not an address", () => {
    expect(inviteeEmailSchema.safeParse("parent one").success).toBe(false);
  });
});
