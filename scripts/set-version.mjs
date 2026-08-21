import { readFile, writeFile } from "node:fs/promises";
import {
  assertSynchronizedVersions,
  compareSemver,
  readVersionState,
  replaceGradleVersion,
  replaceLockVersions,
  replacePackageVersion,
  SEMVER_PATTERN,
  VERSION_PATHS,
} from "./versioning.mjs";

const [nextVersion, ...extra] = process.argv.slice(2);
if (!nextVersion || extra.length || !SEMVER_PATTERN.test(nextVersion)) {
  throw new Error("Usage: npm run version:set -- X.Y.Z");
}

const current = assertSynchronizedVersions(await readVersionState());
if (compareSemver(nextVersion, current.rootVersion) <= 0) {
  throw new Error(`New version must be greater than ${current.rootVersion}; received: ${nextVersion}`);
}
const nextVersionCode = current.androidVersionCode + 1;
if (!Number.isSafeInteger(nextVersionCode) || nextVersionCode <= current.androidVersionCode) {
  throw new Error(`Cannot increment Android versionCode ${current.androidVersionCode}`);
}

const [rootPackage, rootLock, androidPackage, androidLock, gradle] = await Promise.all([
  readFile(VERSION_PATHS.rootPackage, "utf8"),
  readFile(VERSION_PATHS.rootLock, "utf8"),
  readFile(VERSION_PATHS.androidPackage, "utf8"),
  readFile(VERSION_PATHS.androidLock, "utf8"),
  readFile(VERSION_PATHS.gradle, "utf8"),
]);
const updates = [
  [VERSION_PATHS.rootPackage, replacePackageVersion(rootPackage, nextVersion)],
  [VERSION_PATHS.rootLock, replaceLockVersions(rootLock, nextVersion)],
  [VERSION_PATHS.androidPackage, replacePackageVersion(androidPackage, nextVersion)],
  [VERSION_PATHS.androidLock, replaceLockVersions(androidLock, nextVersion)],
  [VERSION_PATHS.gradle, replaceGradleVersion(gradle, nextVersion, nextVersionCode)],
];
await Promise.all(updates.map(([target, content]) => writeFile(target, content, "utf8")));

assertSynchronizedVersions(await readVersionState());
console.log(`Notebook version updated: ${current.rootVersion} -> ${nextVersion}`);
console.log(`Android versionCode updated: ${current.androidVersionCode} -> ${nextVersionCode}`);
