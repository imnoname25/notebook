import assert from "node:assert/strict";
import { androidClientUrl, readNativeAppInfo } from "../www/app-info.js";
import xcode from "xcode";
// The CLI's xcode helper uses only uuid.v4; verify its patched CJS dependency.
const project = xcode.project("unused-test-project");
project.hash = { project: { objects: {} } };
assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
const info = { versionName: "0.6.0-g12345678", versionCode: 6, gitCommit: "12345678".repeat(5), sourceDirty: false, debug: true };
assert.deepEqual(await readNativeAppInfo({ Plugins: { NotebookAppInfo: { getInfo: async () => info } } }), info);
assert.equal(await readNativeAppInfo({}), null);
assert.equal(await readNativeAppInfo({ Plugins: { NotebookAppInfo: { getInfo: () => new Promise(() => {}) } } }, 1), null);
assert.equal(await readNativeAppInfo({ Plugins: { NotebookAppInfo: { getInfo: async () => { throw new Error("old native build"); } } } }), null);
assert.equal(await readNativeAppInfo({ Plugins: { NotebookAppInfo: { getInfo: async () => ({ ...info, gitCommit: "unknown" }) } } }), null);
const url = new URL(androidClientUrl("https://notes.example.test", info));
assert.equal(url.pathname, "/app");
assert.equal(url.searchParams.get("version"), "0.6.0");
assert.equal(url.searchParams.get("clientCommit"), info.gitCommit);
assert.equal(new URL(androidClientUrl("https://notes.example.test", null)).searchParams.get("version"), null);
console.log("Android native build identity and bootstrap URL checks passed");
