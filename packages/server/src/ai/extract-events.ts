// The extraction port named in the milestone 3 file list. The adapter returns typed candidates
// and provenance; it never writes to the database and it has no tools (AGENTS.md).
import type { ExtractionInput, ExtractionOutput, ExtractionProvenance } from "@handoff/contracts";

export interface ExtractionResult {
  output: ExtractionOutput;
  provenance: ExtractionProvenance;
}

export interface ExtractionProvider {
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}
