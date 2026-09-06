import { describe, expect, it } from "vitest";
import type { ChildPermission } from "@handoff/contracts";
import type { AccessContext } from "../types/permissions";
import {
  canCorrectEvent,
  canCreateCapture,
  canDeleteChild,
  canInviteMembers,
  canManageChildGrants,
  canReadChild,
  canReadOtherAuthorDraft,
  canStartOwnCareSession,
  resolveEffectiveChildPermission,
} from "./permissions";

type ExpectedAbilities = {
  effective: ChildPermission | null;
  readChild: boolean;
  createCapture: boolean;
  correctOwnEvent: boolean;
  correctOtherEvent: boolean;
  readOtherAuthorDraft: boolean;
  manageChildGrants: boolean;
  inviteMembers: boolean;
  deleteChild: boolean;
  startOwnCareSession: boolean;
};

const noAbilities: ExpectedAbilities = {
  effective: null,
  readChild: false,
  createCapture: false,
  correctOwnEvent: false,
  correctOtherEvent: false,
  readOtherAuthorDraft: false,
  manageChildGrants: false,
  inviteMembers: false,
  deleteChild: false,
  startOwnCareSession: false,
};

const readOnlyAbilities: ExpectedAbilities = {
  ...noAbilities,
  effective: "reader",
  readChild: true,
  startOwnCareSession: true,
};

const contributorAbilities: ExpectedAbilities = {
  ...readOnlyAbilities,
  effective: "contributor",
  createCapture: true,
  correctOwnEvent: true,
};

const managerAbilities: ExpectedAbilities = {
  ...contributorAbilities,
  effective: "manager",
  correctOtherEvent: true,
  manageChildGrants: true,
  inviteMembers: true,
};

// data-contract.md §7 read as a table: each row is a real actor, each column an action the doc names.
const cases: { name: string; ctx: AccessContext; expected: ExpectedAbilities }[] = [
  {
    name: "owner with no child grant has workspace-wide access",
    ctx: { appRole: "owner", membershipStatus: "active", grant: null },
    expected: { ...managerAbilities, readOtherAuthorDraft: true, deleteChild: true },
  },
  {
    name: "owner is not limited by a narrower child grant",
    ctx: {
      appRole: "owner",
      membershipStatus: "active",
      grant: { permission: "reader", status: "active" },
    },
    expected: { ...managerAbilities, readOtherAuthorDraft: true, deleteChild: true },
  },
  {
    name: "owner keeps workspace scope even where the grant was revoked",
    ctx: {
      appRole: "owner",
      membershipStatus: "active",
      grant: { permission: "manager", status: "revoked" },
    },
    expected: { ...managerAbilities, readOtherAuthorDraft: true, deleteChild: true },
  },
  {
    name: "staff with a manager grant may correct and manage within scope",
    ctx: {
      appRole: "staff",
      membershipStatus: "active",
      grant: { permission: "manager", status: "active" },
    },
    expected: managerAbilities,
  },
  {
    name: "staff with a contributor grant may correct only their own events",
    ctx: {
      appRole: "staff",
      membershipStatus: "active",
      grant: { permission: "contributor", status: "active" },
    },
    expected: contributorAbilities,
  },
  {
    name: "household caregiver with a contributor grant may capture care",
    ctx: {
      appRole: "caregiver",
      membershipStatus: "active",
      grant: { permission: "contributor", status: "active" },
    },
    expected: contributorAbilities,
  },
  {
    name: "caregiver with a reader grant may read and self-report care only",
    ctx: {
      appRole: "caregiver",
      membershipStatus: "active",
      grant: { permission: "reader", status: "active" },
    },
    expected: readOnlyAbilities,
  },
  {
    name: "caregiver without a grant has no access to the child",
    ctx: { appRole: "caregiver", membershipStatus: "active", grant: null },
    expected: noAbilities,
  },
  {
    name: "caregiver with a revoked grant has no access to the child",
    ctx: {
      appRole: "caregiver",
      membershipStatus: "active",
      grant: { permission: "manager", status: "revoked" },
    },
    expected: noAbilities,
  },
  {
    name: "daycare guardian with a reader grant is read-only",
    ctx: {
      appRole: "guardian",
      membershipStatus: "active",
      grant: { permission: "reader", status: "active" },
    },
    expected: readOnlyAbilities,
  },
  {
    name: "guardian ceiling holds against an erroneous contributor grant",
    ctx: {
      appRole: "guardian",
      membershipStatus: "active",
      grant: { permission: "contributor", status: "active" },
    },
    expected: readOnlyAbilities,
  },
  {
    name: "guardian ceiling holds against an erroneous manager grant",
    ctx: {
      appRole: "guardian",
      membershipStatus: "active",
      grant: { permission: "manager", status: "active" },
    },
    expected: readOnlyAbilities,
  },
  {
    name: "guardian without a grant sees nothing in the daycare workspace",
    ctx: { appRole: "guardian", membershipStatus: "active", grant: null },
    expected: noAbilities,
  },
  {
    name: "revoked owner loses workspace-wide access",
    ctx: { appRole: "owner", membershipStatus: "revoked", grant: null },
    expected: noAbilities,
  },
  {
    name: "revoked staff loses an otherwise active manager grant",
    ctx: {
      appRole: "staff",
      membershipStatus: "revoked",
      grant: { permission: "manager", status: "active" },
    },
    expected: noAbilities,
  },
];

describe("child permission matrix", () => {
  it.each(cases)("$name", ({ ctx, expected }) => {
    const actual: ExpectedAbilities = {
      effective: resolveEffectiveChildPermission(ctx),
      readChild: canReadChild(ctx),
      createCapture: canCreateCapture(ctx),
      correctOwnEvent: canCorrectEvent({ ctx, isAuthor: true }),
      correctOtherEvent: canCorrectEvent({ ctx, isAuthor: false }),
      readOtherAuthorDraft: canReadOtherAuthorDraft(ctx),
      manageChildGrants: canManageChildGrants(ctx),
      inviteMembers: canInviteMembers(ctx),
      deleteChild: canDeleteChild(ctx),
      startOwnCareSession: canStartOwnCareSession(ctx),
    };
    expect(actual).toEqual(expected);
  });
});

describe("documented ceilings and exclusives", () => {
  it("never grants a guardian more than a reader can do, whatever the grant says", () => {
    const permissions: ChildPermission[] = ["reader", "contributor", "manager"];
    for (const permission of permissions) {
      const ctx: AccessContext = {
        appRole: "guardian",
        membershipStatus: "active",
        grant: { permission, status: "active" },
      };
      expect(resolveEffectiveChildPermission(ctx)).toBe("reader");
      expect(canCreateCapture(ctx)).toBe(false);
      expect(canManageChildGrants(ctx)).toBe(false);
    }
  });

  it("reserves raw draft reads and child deletion for owners", () => {
    const nonOwnerManager: AccessContext = {
      appRole: "staff",
      membershipStatus: "active",
      grant: { permission: "manager", status: "active" },
    };
    expect(canReadOtherAuthorDraft(nonOwnerManager)).toBe(false);
    expect(canDeleteChild(nonOwnerManager)).toBe(false);
  });

  it("denies every action once membership is revoked", () => {
    const ctx: AccessContext = {
      appRole: "owner",
      membershipStatus: "revoked",
      grant: { permission: "manager", status: "active" },
    };
    expect(canReadChild(ctx)).toBe(false);
    expect(canStartOwnCareSession(ctx)).toBe(false);
    expect(canInviteMembers(ctx)).toBe(false);
  });
});
