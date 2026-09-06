import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { outboxSchemaSql } from "./schema";

const sqlPath = fileURLToPath(new URL("./schema.sql", import.meta.url));

describe("outboxSchemaSql", () => {
  it("matches the reviewed schema.sql, so the bundled DDL cannot drift from it", () => {
    const onDisk = readFileSync(sqlPath, "utf8").replaceAll("\r\n", "\n");
    expect(outboxSchemaSql).toBe(onDisk);
  });

  it("declares no transcript or draft column, only ids, state, and a file reference", () => {
    const columns = outboxSchemaSql
      .split("\n")
      .filter((line) => line.startsWith("  ") && !line.trimStart().startsWith("--"))
      .join("\n");
    expect(columns).not.toMatch(/transcript|draft|candidate|payload|text_content/i);
  });
});
