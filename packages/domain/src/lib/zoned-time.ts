import type { WallClock, ZonedResolution } from "../types/zoned-time";

const DAY_MS = 86_400_000;

// Intl carries the IANA rules already, so the offset is probed rather than adding a date library.
const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timezone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timezone, formatter);
  return formatter;
}

function readParts(instant: Date, timezone: string): WallClock & { second: number } {
  const parts = zonedFormatter(timezone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Some ICU builds report midnight as hour 24; normalize so comparisons stay simple.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

export function getZonedParts(instant: Date, timezone: string): WallClock {
  const { year, month, day, hour, minute } = readParts(instant, timezone);
  return { year, month, day, hour, minute };
}

function offsetMs(instant: Date, timezone: string): number {
  const parts = readParts(instant, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function matchesWall(instant: Date, wall: WallClock, timezone: string): boolean {
  const actual = getZonedParts(instant, timezone);
  return (
    actual.year === wall.year &&
    actual.month === wall.month &&
    actual.day === wall.day &&
    actual.hour === wall.hour &&
    actual.minute === wall.minute
  );
}

// Probes the offsets in force a day either side of the target so both readings of a fall-back
// hour are considered, then keeps only the instants that really format back to this wall time.
export function zonedTimeToInstant(wall: WallClock, timezone: string): ZonedResolution {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const probes = [target - DAY_MS, target, target + DAY_MS];
  const candidates: number[] = [];
  for (const probe of probes) {
    const candidate = target - offsetMs(new Date(probe), timezone);
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  candidates.sort((a, b) => a - b);

  const matched = candidates.filter((candidate) =>
    matchesWall(new Date(candidate), wall, timezone),
  );
  if (matched.length === 0) {
    // Inside a spring-forward gap this wall time never happens. The pre-transition offset is
    // always the smaller one, so its candidate is the latest: resolving forward past the shift.
    const fallback = candidates[candidates.length - 1];
    const instant = fallback === undefined ? target : fallback;
    return { instants: [new Date(instant)], ambiguous: false, nonexistent: true };
  }
  return {
    instants: matched.map((value) => new Date(value)),
    ambiguous: matched.length > 1,
    nonexistent: false,
  };
}

export function shiftWallDay(wall: WallClock, days: number): WallClock {
  const anchor = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
    hour: wall.hour,
    minute: wall.minute,
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatWallClock(instant: Date, timezone: string): string {
  const wall = getZonedParts(instant, timezone);
  return `${pad(wall.hour, 2)}:${pad(wall.minute, 2)}`;
}

export function formatWallDate(instant: Date, timezone: string): string {
  const wall = getZonedParts(instant, timezone);
  return `${pad(wall.year, 4)}-${pad(wall.month, 2)}-${pad(wall.day, 2)}`;
}

// Whole local days between two instants, used for "yesterday" style labels.
export function wallDayDifference(from: Date, to: Date, timezone: string): number {
  const start = getZonedParts(from, timezone);
  const end = getZonedParts(to, timezone);
  const startDay = Date.UTC(start.year, start.month - 1, start.day);
  const endDay = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endDay - startDay) / DAY_MS);
}
