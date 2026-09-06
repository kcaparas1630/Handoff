import type { z } from "zod";
import type {
  birthdateSchema,
  childCaregiverDtoSchema,
  childCaregiverGrantSchema,
  childDtoSchema,
  childStatusSchema,
  createChildRequestSchema,
  updateChildCaregiversRequestSchema,
  updateChildRequestSchema,
} from "../schemas/children";

export type Birthdate = z.infer<typeof birthdateSchema>;
export type ChildStatus = z.infer<typeof childStatusSchema>;
export type ChildDto = z.infer<typeof childDtoSchema>;
export type CreateChildRequest = z.infer<typeof createChildRequestSchema>;
export type UpdateChildRequest = z.infer<typeof updateChildRequestSchema>;
export type ChildCaregiverDto = z.infer<typeof childCaregiverDtoSchema>;
export type ChildCaregiverGrant = z.infer<typeof childCaregiverGrantSchema>;
export type UpdateChildCaregiversRequest = z.infer<typeof updateChildCaregiversRequestSchema>;
