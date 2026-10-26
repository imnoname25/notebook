import { describe, expect, it } from "vitest";
import { androidAppInfoSchema } from "./android-app-info";
const info = { versionName: "0.6.0-g12345678", versionCode: 6, gitCommit: "12345678".repeat(5), sourceDirty: false, debug: true };
describe("native Android build identity", () => {
  it("accepts a native version and full source commit", () => expect(androidAppInfoSchema.parse(info)).toEqual(info));
  it.each([{ gitCommit: "unknown" }, { versionCode: 0 }, { versionName: "not-a-build" }, { sourceDirty: "false" }])("rejects untrusted bridge metadata %j", value => expect(androidAppInfoSchema.safeParse({ ...info, ...value }).success).toBe(false));
});
