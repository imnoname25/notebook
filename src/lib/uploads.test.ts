import { describe, expect, it } from "vitest";
import { isValidImageMime } from "./uploads";

describe("upload MIME verification", () => {
  it("accepts a valid PNG signature", () => expect(isValidImageMime("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(true));
  it("rejects content that only claims to be an image", () => expect(isValidImageMime("image/png", new TextEncoder().encode("not an image"))).toBe(false));
  it("rejects unsupported MIME types", () => expect(isValidImageMime("image/svg+xml", new Uint8Array())).toBe(false));
});
