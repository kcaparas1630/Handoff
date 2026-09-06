import type { z } from "zod";
import type {
  acknowledgeBriefRequestSchema,
  acknowledgeBriefResponseSchema,
  briefContextFactSchema,
  briefEntryLabelSchema,
  briefEntrySchema,
  briefSnapshotSchema,
  briefStatusSchema,
  contextFactKindSchema,
  handoffBriefDtoSchema,
} from "../schemas/handoffs";

export type BriefStatus = z.infer<typeof briefStatusSchema>;
export type BriefEntryLabel = z.infer<typeof briefEntryLabelSchema>;
export type ContextFactKind = z.infer<typeof contextFactKindSchema>;
export type BriefEntry = z.infer<typeof briefEntrySchema>;
export type BriefContextFact = z.infer<typeof briefContextFactSchema>;
export type BriefSnapshot = z.infer<typeof briefSnapshotSchema>;
export type HandoffBriefDto = z.infer<typeof handoffBriefDtoSchema>;
export type AcknowledgeBriefRequest = z.infer<typeof acknowledgeBriefRequestSchema>;
export type AcknowledgeBriefResponse = z.infer<typeof acknowledgeBriefResponseSchema>;
