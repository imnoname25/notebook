import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("release channel contract", () => {
  const workflow = readFileSync(".github/workflows/docker-publish.yml", "utf8");
  const android = readFileSync(".github/workflows/android-build.yml", "utf8");
  const template = readFileSync("unraid/notebook.xml", "utf8");

  it("publishes edge from main and latest only from stable tags", () => {
    expect(workflow).toContain("type=raw,value=edge,enable={{is_default_branch}}");
    expect(workflow).toContain("type=raw,value=latest");
    expect(workflow).toContain("!contains(github.ref_name, '-')");
    expect(template).toContain("ghcr.io/imnoname25/notebook:latest");
  });

  it("publishes a signed, version-named APK as a release asset", () => {
    expect(android).toContain("ANDROID_KEYSTORE_BASE64");
    expect(android).toContain('dist/Notebook-${version}.apk');
    expect(android).toContain("softprops/action-gh-release@v2");
  });

  it("installs the project's compile SDK without the retired tools package", () => {
    const gradle = readFileSync("android-client/android/variables.gradle", "utf8");
    const compileSdk = gradle.match(/compileSdkVersion\s*=\s*(\d+)/)?.[1];
    expect(compileSdk).toBeDefined();
    const packages = [...android.matchAll(/packages:\s*'([^']+)'/g)];
    expect(packages).toHaveLength(2);
    for (const [, list] of packages) {
      const tokens = list.split(/\s+/);
      expect(tokens).toContain(`platforms;android-${compileSdk}`);
      expect(tokens).toContain("build-tools;35.0.0");
      expect(tokens).not.toContain("tools");
    }
  });
});
