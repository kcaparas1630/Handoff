import type { EventFieldError } from "@handoff/domain";

import type { EntryFieldErrors } from "../types/entry-field-groups";

/** Keeps the first message per field so a group renders one sentence under the offending input. */
export function toFieldErrors(errors: readonly EventFieldError[]): EntryFieldErrors {
  const messages: Record<string, string> = {};
  for (const error of errors) {
    if (messages[error.field] === undefined) messages[error.field] = error.message;
  }
  return messages;
}

/** The same shape from an API error envelope, where each field carries a list of messages. */
export function fieldErrorsFromApi(
  fieldErrors: Readonly<Record<string, readonly string[]>> | null,
): EntryFieldErrors {
  if (fieldErrors === null) return {};
  const messages: Record<string, string> = {};
  for (const [field, list] of Object.entries(fieldErrors)) {
    const first = list[0];
    if (first !== undefined) messages[field] = first;
  }
  return messages;
}
