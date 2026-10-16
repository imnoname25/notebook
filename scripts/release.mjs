import { spawnSync } from "node:child_process";
import { assertSynchronizedVersions, compareSemver, parseGradleVersion, readVersionState, REPOSITORY_ROOT, SEMVER_PATTERN } from "./versioning.mjs";

// Dry run by default. Only an explicit --publish creates and pushes a tag.
const [tag, mode, ...extra] = process.argv.slice(2);
if (!tag?.startsWith("v") || !SEMVER_PATTERN.test(tag.slice(1)) || (mode && mode !== "--publish") || extra.length) {
  throw new Error("Usage: npm run release -- vX.Y.Z [--publish]");
}
const publish = mode === "--publish";
function run(command, args, capture = false, cwd = REPOSITORY_ROOT) {
  const result = spawnSync(command, args, {
    cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit",
    shell: process.platform === "win32" && command === "npm",
  });
  if (result.error || result.status !== 0) throw new Error(`${command} failed; release stopped`);
  return result.stdout?.trim() ?? "";
}
const git = (...args) => run("git", args, true);
function assertCleanMain() {
  if (git("branch", "--show-current") !== "main") throw new Error("Release requires main");
  if (git("status", "--porcelain")) throw new Error("Release requires a clean working tree and index");
  const remote = git("remote", "get-url", "--push", "origin");
  if (!/^(https:\/\/github\.com\/imnoname25\/notebook(?:\.git)?|git@github\.com:imnoname25\/notebook(?:\.git)?)$/.test(remote)) {
    throw new Error("Unexpected origin; release stopped");
  }
}
assertCleanMain();
if (publish) run("git", ["fetch", "origin", "main", "--tags"]);
const commit = git("rev-parse", "HEAD");
if (commit !== git("rev-parse", "refs/remotes/origin/main")) throw new Error("Push main successfully before releasing");
const version = assertSynchronizedVersions(await readVersionState());
if (tag.slice(1) !== version.rootVersion) throw new Error("Tag must match the synchronized application version");
const tags = git("tag", "--list").split(/\r?\n/);
if (tags.includes(tag)) throw new Error("Tag already exists; never overwrite release tags");
for (const previousTag of tags.filter((value) => value.startsWith("v") && SEMVER_PATTERN.test(value.slice(1)))) {
  if (compareSemver(tag.slice(1), previousTag.slice(1)) <= 0) throw new Error("Release version must increase beyond every existing stable tag");
  const previous = parseGradleVersion(git("show", `${previousTag}:android-client/android/app/build.gradle`));
  if (version.androidVersionCode <= previous.versionCode) throw new Error("Android versionCode must increase beyond previous releases");
}
console.log(`Release plan: ${tag} at ${commit}; Docker amd64/arm64 and signed Android APK/AAB via existing tag workflows.`);
if (!publish) {
  console.log("Dry run only: no tag or release created. Explicit --publish runs checks, creates the tag and pushes only that tag.");
} else {
  run("npm", ["run", "check"]);
  run("npm", ["run", "validate:docker"]);
  run("npm", ["run", "validate:unraid"]);
  run("gitleaks", ["git", "--redact", "--no-banner", "--log-opts=-1"]);
  const androidRoot = `${REPOSITORY_ROOT}/android-client`;
  run("npm", ["ci"], false, androidRoot);
  run("npm", ["run", "check"], false, androidRoot);
  run("npm", ["run", "sync"], false, androidRoot);
  const windows = process.platform === "win32";
  // cmd /c is needed only for the checked-in Windows Gradle wrapper.
  run(windows ? "cmd.exe" : "./android/gradlew", windows
    ? ["/d", "/c", "android\\gradlew.bat", "--no-daemon", "-p", "android", "lintDebug", "testDebugUnitTest", "assembleDebug"]
    : ["--no-daemon", "-p", "android", "lintDebug", "testDebugUnitTest", "assembleDebug"], false, androidRoot);
  assertCleanMain();
  if (git("rev-parse", "HEAD") !== commit) throw new Error("HEAD changed during checks; release stopped");
  run("git", ["fetch", "origin", "main"]);
  if (git("rev-parse", "refs/remotes/origin/main") !== commit) throw new Error("Remote main changed; check the new commit before releasing");
  run("git", ["tag", "-a", tag, commit, "-m", `Notebook ${tag}`]);
  run("git", ["push", "origin", `refs/tags/${tag}`]);
  console.log(`Pushed ${tag}. Follow BOTH existing Actions workflows; a successful tag push does not mean the release builds succeeded.`);
}
