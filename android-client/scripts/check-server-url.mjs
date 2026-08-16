import assert from "node:assert/strict";
import { normalizeServerUrl } from "../www/server-url.js";

assert.equal(normalizeServerUrl("https://notes.example.com/"), "https://notes.example.com");
assert.equal(normalizeServerUrl("http://192.168.1.10:3000"), "http://192.168.1.10:3000");
assert.throws(() => normalizeServerUrl("javascript:alert(1)"));
assert.throws(() => normalizeServerUrl("https://user:password@example.com"));
assert.throws(() => normalizeServerUrl("https://example.com/?redirect=evil"));
console.log("Android server URL checks passed");
