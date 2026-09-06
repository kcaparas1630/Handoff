import type { EntryFieldGroupProps } from "../types/entry-field-group";
import { DiaperFields } from "./DiaperFields";
import { FeedFields } from "./FeedFields";
import { MilestoneFields } from "./MilestoneFields";
import { NoteFields } from "./NoteFields";
import { SleepFields } from "./SleepFields";

/** Renders only the fields that belong to this kind, for both quick entry and corrections. */
export function EntryFieldGroup({ kind, form, onChange, timezone, errors }: EntryFieldGroupProps) {
  if (kind === "feed") {
    return (
      <FeedFields
        fields={form.feed}
        onChange={(feed) => onChange({ ...form, feed })}
        errors={errors}
      />
    );
  }
  if (kind === "diaper") {
    return (
      <DiaperFields
        fields={form.diaper}
        onChange={(diaper) => onChange({ ...form, diaper })}
        errors={errors}
      />
    );
  }
  if (kind === "sleep") {
    return (
      <SleepFields
        fields={form.sleep}
        onChange={(sleep) => onChange({ ...form, sleep })}
        endOccurrence={form.endOccurrence}
        onEndOccurrenceChange={(endOccurrence) => onChange({ ...form, endOccurrence })}
        timezone={timezone}
        errors={errors}
      />
    );
  }
  if (kind === "milestone") {
    return (
      <MilestoneFields
        fields={form.milestone}
        onChange={(milestone) => onChange({ ...form, milestone })}
        errors={errors}
      />
    );
  }
  return (
    <NoteFields
      fields={form.note}
      onChange={(note) => onChange({ ...form, note })}
      errors={errors}
    />
  );
}
