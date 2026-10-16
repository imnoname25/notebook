import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("release preflight safety", { timeout: 30_000, hookTimeout: 30_000 }, () => {
  let root;
  function git(...args) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  }
  function run(tag = "v0.6.0") {
    return spawnSync(process.execPath, ["scripts/release.mjs", tag], { cwd: root, encoding: "utf8" });
  }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "notebook-release-"));
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "android-client/android/app"), { recursive: true });
    for (const file of ["release.mjs", "versioning.mjs"]) {
      writeFileSync(join(root, "scripts", file), readFileSync(new URL(file, import.meta.url)));
    }
    for (const prefix of ["", "android-client/"]) {
      writeFileSync(join(root, `${prefix}package.json`), JSON.stringify({ version: "0.6.0" }));
      writeFileSync(join(root, `${prefix}package-lock.json`), JSON.stringify({ version: "0.6.0", packages: { "": { version: "0.6.0" } } }));
    }
    writeFileSync(join(root, "android-client/android/app/build.gradle"), 'versionName "0.6.0"\nversionCode 6\n');
    git("init", "--initial-branch=main");
    git("config", "user.name", "Release test");
    git("config", "user.email", "test@example.invalid");
    git("remote", "add", "origin", "https://github.com/imnoname25/notebook.git");
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-m", "fixture");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
  });
  afterEach(() => {
    if (!root?.startsWith(join(tmpdir(), "notebook-release-"))) throw new Error("Unsafe fixture cleanup path");
    rmSync(root, { recursive: true, force: true });
  });

  it("dry run creates no tag and does not change HEAD or working files", () => {
    const head = git("rev-parse", "HEAD");
    const result = run();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Dry run only");
    expect(git("tag", "--list")).toBe("");
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("rejects unfinished work, even untracked files", () => {
    writeFileSync(join(root, "unfinished.txt"), "work");
    expect(run().stderr).toContain("clean working tree");
    expect(git("tag", "--list")).toBe("");
  });

  it("rejects a tag that disagrees with the app version", () => {
    expect(run("v0.7.0").stderr).toContain("Tag must match");
    expect(git("tag", "--list")).toBe("");
  });

  it("never overwrites an existing release tag", () => {
    git("tag", "v0.6.0");
    expect(run().stderr).toContain("Tag already exists");
  });

  it("rejects reused Android versionCode", () => {
    git("tag", "v0.5.0");
    expect(run().stderr).toContain("versionCode must increase");
  });

  it("rejects lock metadata drift", () => {
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ version: "0.5.0" }));
    git("add", "package-lock.json");
    git("-c", "commit.gpgsign=false", "commit", "-m", "drift fixture");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    expect(run().stderr).toContain("Version mismatch in package-lock.json");
  });
});
