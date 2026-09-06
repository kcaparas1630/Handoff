import type {
  DiaperFormFields,
  FeedFormFields,
  MilestoneFormFields,
  NoteFormFields,
  OccurrenceTime,
  SleepFormFields,
} from "./entry-form";

/** Field path to message, as returned by the shared domain rules or the server envelope. */
export type EntryFieldErrors = Readonly<Record<string, string>>;

export type FeedFieldsProps = {
  fields: FeedFormFields;
  onChange: (fields: FeedFormFields) => void;
  errors: EntryFieldErrors;
};

export type DiaperFieldsProps = {
  fields: DiaperFormFields;
  onChange: (fields: DiaperFormFields) => void;
  errors: EntryFieldErrors;
};

export type SleepFieldsProps = {
  fields: SleepFormFields;
  onChange: (fields: SleepFormFields) => void;
  /** A sleep interval records an end time, so the group owns that control. */
  endOccurrence: OccurrenceTime;
  onEndOccurrenceChange: (value: OccurrenceTime) => void;
  timezone: string;
  errors: EntryFieldErrors;
};

export type MilestoneFieldsProps = {
  fields: MilestoneFormFields;
  onChange: (fields: MilestoneFormFields) => void;
  errors: EntryFieldErrors;
};

export type NoteFieldsProps = {
  fields: NoteFormFields;
  onChange: (fields: NoteFormFields) => void;
  errors: EntryFieldErrors;
};
