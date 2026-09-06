import type { EventKind } from "@handoff/contracts";

import type { EntryFieldErrors } from "./entry-field-groups";
import type { EntryForm } from "./entry-form";

export type EntryFieldGroupProps = {
  kind: EventKind;
  form: EntryForm;
  onChange: (form: EntryForm) => void;
  timezone: string;
  errors: EntryFieldErrors;
};
