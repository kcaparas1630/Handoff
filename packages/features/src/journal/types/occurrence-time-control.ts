import type { OccurrenceTime } from "./entry-form";

export type OccurrenceTimeControlProps = {
  label: string;
  /** Workspace time zone; the picker and the readback both use it, never the device zone. */
  timezone: string;
  value: OccurrenceTime;
  onChange: (value: OccurrenceTime) => void;
  /** Off for a sleep interval's end, where an unknown time would contradict the interval. */
  allowUnknown?: boolean;
  errorMessage?: string | undefined;
  testID?: string;
};
