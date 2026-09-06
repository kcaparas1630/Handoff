export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

// A wall-clock reading maps to two instants on a fall-back day and to none inside a
// spring-forward gap; both cases are uncertainty the user has to see.
export type ZonedResolution = {
  instants: Date[];
  ambiguous: boolean;
  nonexistent: boolean;
};
