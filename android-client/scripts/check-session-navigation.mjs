import assert from "node:assert/strict";
import { openNotebook } from "../www/open-notebook.js";

const target = "https://notes.example.test/app?client=android";
const nativeCalls = [];
const replacements = [];
const replace = url => replacements.push(url);
await openNotebook(target, { isNativePlatform: () => true, Plugins: { NotebookSession: { openNotebook: async input => nativeCalls.push(input) } } }, replace);
assert.deepEqual(nativeCalls, [{ url: target }]);
assert.deepEqual(replacements, []);
await openNotebook(target, undefined, replace);
assert.deepEqual(replacements, [target]);
await assert.rejects(openNotebook(target, { isNativePlatform: () => true }, replace), /Native-переход недоступен/);
await assert.rejects(openNotebook(target, { isNativePlatform: () => true, Plugins: { NotebookSession: { openNotebook: async () => { throw new Error("rejected navigation"); } } } }, replace), /rejected navigation/);
assert.deepEqual(replacements, [target], "Native failure must not silently retry the broken cross-site JS navigation");
console.log("Android native session navigation checks passed");
