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

  it("gates registry publication on all validation and runtime smoke checks", () => {
    const smoke = workflow.split("\n  smoke:")[1]?.split("\n  publish:")[0];
    const publish = workflow.split("\n  publish:")[1];
    expect(smoke).toContain("needs: validate");
    expect(publish).toContain("needs: smoke");
    expect(publish).toContain("github.event_name != 'pull_request'");
    expect(workflow).toContain("run: npm run check");
    expect(workflow).toContain("run: ./unraid/test-windows-runner.ps1");
    expect(smoke).toContain("/api/health/ready");
    expect(smoke).toContain("docker restart notebook-smoke-app");
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
  });

  it("reads back the multi-arch registry publication before binding its artifact", () => {
    const publish = workflow.split("\n  publish:")[1];
    expect(publish).toContain("platforms: linux/amd64,linux/arm64");
    expect(publish).toContain("provenance: mode=max");
    expect(publish).toContain("sbom: true");
    expect(publish).toContain("cache-to: type=gha,mode=max,scope=notebook-multiarch");
    const verification = publish.indexOf("- name: Verify published registry digest, tags and platforms");
    expect(verification).toBeGreaterThan(publish.indexOf("- name: Build and publish multi-arch image"));
    expect(verification).toBeLessThan(publish.indexOf("- name: Bind published digest to checked source"));
    expect(publish).toContain('imagetools inspect "$IMAGE@$EXPECTED_DIGEST"');
    expect(publish).toContain('imagetools inspect "$tag"');
    expect(publish).toContain('[[ "$actual_digest" != "$EXPECTED_DIGEST" ]]');
    expect(publish).toContain('index("amd64") != null and index("arm64") != null');
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
