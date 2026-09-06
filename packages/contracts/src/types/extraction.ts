import type { z } from "zod";
import type {
  expectedCandidateSchema,
  extractionCandidateSchema,
  extractionInputSchema,
  extractionOutputSchema,
  extractionProvenanceSchema,
  spokenTimeSchema,
} from "../schemas/extraction";

export type SpokenTimeComponents = z.infer<typeof spokenTimeSchema>;
export type ExtractionCandidate = z.infer<typeof extractionCandidateSchema>;
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;
export type ExtractionInput = z.infer<typeof extractionInputSchema>;
export type ExtractionProvenance = z.infer<typeof extractionProvenanceSchema>;
export type ExpectedCandidate = z.infer<typeof expectedCandidateSchema>;
