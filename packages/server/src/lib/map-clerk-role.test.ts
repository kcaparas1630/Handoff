import { describe, expect, it } from "vitest";
import { isClerkOrgAdmin, mapAppRoleToClerkRole, mapClerkRoleToAppRole } from "./map-clerk-role";

const guardianRoleKey = "org:handoff_guardian";

describe("mapClerkRoleToAppRole", () => {
  it("maps the Clerk administrator to a workspace owner", () => {
    expect(
      mapClerkRoleToAppRole({ clerkRole: "org:admin", intendedAppRole: null, guardianRoleKey }),
    ).toBe("owner");
  });

  it("maps the configured custom role to a read-only guardian", () => {
    expect(
      mapClerkRoleToAppRole({
        clerkRole: guardianRoleKey,
        intendedAppRole: "staff",
        guardianRoleKey,
      }),
    ).toBe("guardian");
  });

  it("uses the stored invitation intent for an ordinary member", () => {
    expect(
      mapClerkRoleToAppRole({ clerkRole: "org:member", intendedAppRole: "staff", guardianRoleKey }),
    ).toBe("staff");
  });

  it("never promotes a plain member to owner through an intent", () => {
    expect(
      mapClerkRoleToAppRole({ clerkRole: "org:member", intendedAppRole: "owner", guardianRoleKey }),
    ).toBe("caregiver");
  });

  it("defaults a member with no intent to caregiver", () => {
    expect(
      mapClerkRoleToAppRole({ clerkRole: "org:member", intendedAppRole: null, guardianRoleKey }),
    ).toBe("caregiver");
  });
});

describe("mapAppRoleToClerkRole", () => {
  it("sends guardians with the restricted custom role", () => {
    expect(mapAppRoleToClerkRole({ appRole: "guardian", guardianRoleKey })).toBe(guardianRoleKey);
    expect(mapAppRoleToClerkRole({ appRole: "staff", guardianRoleKey })).toBe("org:member");
    expect(mapAppRoleToClerkRole({ appRole: "owner", guardianRoleKey })).toBe("org:admin");
  });
});

describe("isClerkOrgAdmin", () => {
  it("recognizes only the administrator role", () => {
    expect(isClerkOrgAdmin("org:admin")).toBe(true);
    expect(isClerkOrgAdmin("org:member")).toBe(false);
  });
});
