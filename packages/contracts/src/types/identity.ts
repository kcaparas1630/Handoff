import type { z } from "zod";
import type {
  appRoleSchema,
  bootstrapResponseSchema,
  caregiverRelationshipSchema,
  childPermissionSchema,
  createWorkspaceRequestSchema,
  membershipStatusSchema,
  selfUserDtoSchema,
  userDtoSchema,
  workspaceDtoSchema,
  workspaceKindSchema,
  workspaceMemberDtoSchema,
} from "../schemas/identity";

export type AppRole = z.infer<typeof appRoleSchema>;
export type WorkspaceKind = z.infer<typeof workspaceKindSchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;
export type ChildPermission = z.infer<typeof childPermissionSchema>;
export type CaregiverRelationship = z.infer<typeof caregiverRelationshipSchema>;

export type UserDto = z.infer<typeof userDtoSchema>;
export type SelfUserDto = z.infer<typeof selfUserDtoSchema>;
export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;
export type BootstrapResponse = z.infer<typeof bootstrapResponseSchema>;
export type WorkspaceMemberDto = z.infer<typeof workspaceMemberDtoSchema>;
