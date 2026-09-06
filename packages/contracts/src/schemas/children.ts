import { z } from "zod";
import { expectedVersionSchema, versionSchema } from "./api-envelope";
import {
  caregiverRelationshipSchema,
  childPermissionSchema,
  membershipStatusSchema,
} from "./identity";

const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDay = month === 2 && isLeapYear(year) ? 29 : monthLengths[month - 1];
  if (lastDay === undefined) return false;
  return day >= 1 && day <= lastDay;
}

// Calendar validity only. "Not in the future" needs a clock, so the service enforces it.
export const birthdateSchema = z
  .string()
  .refine(isRealCalendarDate, "Expected a real YYYY-MM-DD date");

export const childStatusSchema = z.enum(["active", "archived", "deleting", "deleted"]);

export const childDtoSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  birthdate: birthdateSchema.nullable(),
  status: childStatusSchema,
  // The caller's own effective permission, after app-role ceilings.
  permission: childPermissionSchema,
  version: versionSchema,
});

export const createChildRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  birthdate: birthdateSchema.optional(),
});

export const updateChildRequestSchema = z.object({
  expectedVersion: expectedVersionSchema,
  name: z.string().trim().min(1).max(80).optional(),
  // Explicit null clears a previously recorded birthdate; omission leaves it unchanged.
  birthdate: birthdateSchema.nullable().optional(),
});

export const childCaregiverDtoSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  relationship: caregiverRelationshipSchema,
  permission: childPermissionSchema,
  // Grants share the membership active|revoked lifecycle.
  status: membershipStatusSchema,
  version: versionSchema,
});

export const childCaregiverGrantSchema = z.object({
  userId: z.uuid(),
  relationship: caregiverRelationshipSchema,
  permission: childPermissionSchema,
});

export const updateChildCaregiversRequestSchema = z.object({
  expectedVersion: expectedVersionSchema.optional(),
  grants: z.array(childCaregiverGrantSchema),
  revokeUserIds: z.array(z.uuid()).optional(),
});
