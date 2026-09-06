import { z } from "zod";
import { versionSchema } from "./api-envelope";

export const appRoleSchema = z.enum(["owner", "staff", "caregiver", "guardian"]);
export const workspaceKindSchema = z.enum(["household", "daycare"]);
export const membershipStatusSchema = z.enum(["active", "revoked"]);
export const childPermissionSchema = z.enum(["reader", "contributor", "manager"]);
export const caregiverRelationshipSchema = z.enum(["parent", "relative", "caregiver", "other"]);

// Shape only. Hermes does not reliably implement Intl.supportedValuesOf, and this module is
// bundled into the Expo apps; the server's workspace service checks that the zone really exists.
export const timezoneSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/, "Expected an IANA time zone name");

export const clerkUserIdSchema = z.string().startsWith("user_");
export const clerkOrgIdSchema = z.string().startsWith("org_");

// clerkUserId is deliberately absent: other members never see another user's provider identity.
export const userDtoSchema = z.object({
  id: z.uuid(),
  displayName: z.string().nullable(),
  processingNoticeVersion: z.string().nullable(),
});

export const selfUserDtoSchema = userDtoSchema.extend({
  clerkUserId: clerkUserIdSchema,
});

export const workspaceDtoSchema = z.object({
  id: z.uuid(),
  clerkOrgId: clerkOrgIdSchema,
  kind: workspaceKindSchema,
  name: z.string(),
  timezone: timezoneSchema,
  appRole: appRoleSchema,
  version: versionSchema,
});

export const createWorkspaceRequestSchema = z.object({
  clerkOrgId: clerkOrgIdSchema,
  kind: workspaceKindSchema,
  name: z.string().trim().min(1).max(80),
  timezone: timezoneSchema,
});

export const bootstrapResponseSchema = z.object({
  user: selfUserDtoSchema,
  workspaces: z.array(workspaceDtoSchema),
});

export const workspaceMemberDtoSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  appRole: appRoleSchema,
  status: membershipStatusSchema,
  version: versionSchema,
});
