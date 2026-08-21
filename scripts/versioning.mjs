import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VERSION_PATHS = Object.freeze({
  rootPackage: path.join(REPOSITORY_ROOT, "package.json"),
  rootLock: path.join(REPOSITORY_ROOT, "package-lock.json"),
  androidPackage: path.join(REPOSITORY_ROOT, "android-client", "package.json"),
  androidLock: path.join(REPOSITORY_ROOT, "android-client", "package-lock.json"),
  gradle: path.join(REPOSITORY_ROOT, "android-client", "android", "app", "build.gradle"),
});

export function parseGradleVersion(gradle) {
  const versionNameMatch = gradle.match(/^[ \t]*versionName[ \t]+["']([^"']+)["'][ \t]*$/m);
  const versionCodeMatch = gradle.match(/^[ \t]*versionCode[ \t]+(\d+)[ \t]*$/m);
  if (!versionNameMatch) throw new Error("Android build.gradle does not contain a valid versionName declaration");
  if (!versionCodeMatch) throw new Error("Android build.gradle does not contain a valid integer versionCode declaration");
  const versionCode = Number(versionCodeMatch[1]);
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
    throw new Error(`Android versionCode must be a positive integer; received: ${versionCodeMatch[1]}`);
  }
  return { versionName: versionNameMatch[1], versionCode };
}

export async function readVersionState() {
  const [rootText, androidText, gradle] = await Promise.all([
    readFile(VERSION_PATHS.rootPackage, "utf8"),
    readFile(VERSION_PATHS.androidPackage, "utf8"),
    readFile(VERSION_PATHS.gradle, "utf8"),
  ]);
  const rootPackage = JSON.parse(rootText);
  const androidPackage = JSON.parse(androidText);
  const android = parseGradleVersion(gradle);
  return {
    rootVersion: rootPackage.version,
    androidClientVersion: androidPackage.version,
    androidVersionName: android.versionName,
    androidVersionCode: android.versionCode,
  };
}

export function assertSynchronizedVersions(state) {
  if (!SEMVER_PATTERN.test(state.rootVersion ?? "")) {
    throw new Error(`Root package.json version must use X.Y.Z semver; received: ${state.rootVersion ?? "missing"}`);
  }
  const synchronized = state.rootVersion === state.androidClientVersion && state.rootVersion === state.androidVersionName;
  if (!synchronized) {
    throw new Error([
      "Android version mismatch:",
      `root package.json: ${state.rootVersion ?? "missing"}`,
      `android-client/package.json: ${state.androidClientVersion ?? "missing"}`,
      `build.gradle versionName: ${state.androidVersionName ?? "missing"}`,
    ].join("\n"));
  }
  if (!Number.isSafeInteger(state.androidVersionCode) || state.androidVersionCode <= 0) {
    throw new Error(`Android versionCode must be a positive integer; received: ${state.androidVersionCode}`);
  }
  return state;
}

export function compareSemver(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function replacePackageVersion(source, version) {
  let replaced = false;
  const result = source.replace(/("version"\s*:\s*")[^"]+("(?=\s*[,}]))/, (_match, prefix, suffix) => {
    replaced = true;
    return `${prefix}${version}${suffix}`;
  });
  if (!replaced) throw new Error("package.json does not contain a version field");
  return result;
}

export function replaceLockVersions(source, version) {
  let count = 0;
  const result = source.replace(/("version"\s*:\s*")[^"]+("(?=\s*[,}]))/g, (match, prefix, suffix) => {
    count += 1;
    return count <= 2 ? `${prefix}${version}${suffix}` : match;
  });
  if (count < 2) throw new Error("package-lock.json does not contain root package version metadata");
  return result;
}

export function replaceGradleVersion(source, versionName, versionCode) {
  parseGradleVersion(source);
  return source
    .replace(/^([ \t]*versionName[ \t]+)["'][^"']+["'][ \t]*$/m, `$1"${versionName}"`)
    .replace(/^([ \t]*versionCode[ \t]+)\d+[ \t]*$/m, `$1${versionCode}`);
}
