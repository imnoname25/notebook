import { describe, expect, it } from "vitest";
import {
  assertSynchronizedVersions,
  compareSemver,
  parseGradleVersion,
  replaceGradleVersion,
  replaceLockVersions,
  replacePackageVersion,
} from "./versioning.mjs";

describe("application version contract", () => {
  it("parses a positive Android versionCode independently from versionName", () => {
    expect(parseGradleVersion('versionCode 5\nversionName "0.4.0"\n')).toEqual({ versionName: "0.4.0", versionCode: 5 });
    expect(() => parseGradleVersion('versionCode 0\nversionName "0.4.0"\n')).toThrow("positive integer");
  });

  it("reports all versionName sources on mismatch", () => {
    expect(() => assertSynchronizedVersions({ rootVersion: "0.4.0", androidClientVersion: "0.3.0", androidVersionName: "0.2.0", androidVersionCode: 4 })).toThrow(/root package\.json: 0\.4\.0[\s\S]*android-client\/package\.json: 0\.3\.0[\s\S]*build\.gradle versionName: 0\.2\.0/);
  });

  it("updates only version declarations and increments are ordered", () => {
    expect(replacePackageVersion('{\n  "name": "app",\n  "version": "0.4.0",\n  "private": true\n}\n', "0.4.1")).toContain('"version": "0.4.1"');
    expect(replaceLockVersions('{\n  "version": "0.2.0",\n  "packages": { "": { "version": "0.2.0" }, "x": { "version": "9.0.0" } }\n}', "0.4.1")).toContain('"x": { "version": "9.0.0" }');
    expect(replaceGradleVersion('versionCode 4\nversionName "0.4.0"\n', "0.4.1", 5)).toBe('versionCode 5\nversionName "0.4.1"\n');
    expect(compareSemver("0.4.1", "0.4.0")).toBeGreaterThan(0);
  });
});
