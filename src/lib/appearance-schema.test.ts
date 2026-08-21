import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Appearance 2.0 database defaults", () => {
  it("keeps existing content neutral and owns background uploads by relation", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync(
      "prisma/migrations/202608210001_appearance_2_0/migration.sql",
      "utf8",
    );
    expect(schema).toContain(
      'backgroundType     String        @default("default")',
    );
    expect(schema).toContain(
      'backgroundPattern  String        @default("plain")',
    );
    expect(schema).toContain(
      'pageListView           String   @default("standard")',
    );
    expect(schema).toContain('@relation("PageBackground"');
    expect(migration).toContain(
      'FOREIGN KEY ("backgroundUploadId") REFERENCES "Upload"("id") ON DELETE SET NULL',
    );
  });
});
