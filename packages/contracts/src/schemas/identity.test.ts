import { describe, expect, it } from "vitest";
import { timezoneSchema } from "./identity";

// Shape only: whether the zone exists is the server's semantic check, not this schema's.
describe("workspace timezone shape", () => {
  it.each(["America/New_York", "Europe/Berlin", "UTC", "America/Argentina/Buenos_Aires"])(
    "accepts the IANA-shaped value %s",
    (value) => {
      expect(timezoneSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(["", "-05:00", "/America", "America//New_York", "America/New York", "1America/Denver"])(
    "rejects %s",
    (value) => {
      expect(timezoneSchema.safeParse(value).success).toBe(false);
    },
  );
});
