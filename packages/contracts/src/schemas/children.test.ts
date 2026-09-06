import { describe, expect, it } from "vitest";
import { birthdateSchema } from "./children";

describe("birthdate", () => {
  it.each(["2024-02-29", "2000-02-29", "2023-12-31"])("accepts the real date %s", (value) => {
    expect(birthdateSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    "2023-02-29",
    "1900-02-29",
    "2023-04-31",
    "2023-13-01",
    "2023-00-10",
    "2023-1-01",
    "31-12-2023",
  ])("rejects %s", (value) => {
    expect(birthdateSchema.safeParse(value).success).toBe(false);
  });

  // A future date is a service concern; the schema has no clock.
  it("accepts a far future date and leaves that check to the service", () => {
    expect(birthdateSchema.safeParse("2999-01-01").success).toBe(true);
  });
});
