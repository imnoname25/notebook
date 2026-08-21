import { assertSynchronizedVersions, readVersionState } from "./versioning.mjs";

const [tag, ...extra] = process.argv.slice(2);
if (!tag || extra.length || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error("Release version check requires a stable tag in the form vX.Y.Z");
}
const state = assertSynchronizedVersions(await readVersionState());
const tagVersion = tag.slice(1);
if (tagVersion !== state.rootVersion) {
  throw new Error(`Release tag mismatch:\ngit tag: ${tag}\nroot package.json: ${state.rootVersion}\nandroid-client/package.json: ${state.androidClientVersion}\nbuild.gradle versionName: ${state.androidVersionName}`);
}
console.log(`Release version contract is valid: ${tag} (Android versionCode ${state.androidVersionCode})`);
