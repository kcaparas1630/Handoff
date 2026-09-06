import { customType } from "drizzle-orm/pg-core";

// Drizzle has no first-class bytea column; keyed hashes and wrapped keys are raw bytes, not text.
export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return Uint8Array.from(value);
  },
  toDriver(value) {
    return Buffer.from(value);
  },
});
