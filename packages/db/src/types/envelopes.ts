/** The encrypted columns a workspace content key covers, named by their table. */
export type RotatableTable =
  | "children"
  | "invitation_intents"
  | "captures"
  | "events"
  | "event_revisions"
  | "handoff_briefs"
  | "idempotency_requests";

/**
 * One encrypted column read for re-encryption. `rowId` carries the primary key parts in declared
 * order, which is also what the ciphertext's additional authenticated data binds.
 */
export interface EnvelopeRef {
  rowId: string[];
  envelope: unknown;
}
