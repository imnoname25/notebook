import { describe, expect, it } from "vitest";
import { parseSmartPasteUrl } from "./smart-paste";

describe("parseSmartPasteUrl", () => {
  it("accepts only absolute HTTP(S) URLs", () => {
    expect(parseSmartPasteUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(parseSmartPasteUrl("http://192.168.1.2:3000")).toBe("http://192.168.1.2:3000/");
    expect(parseSmartPasteUrl("javascript:alert(1)")).toBeNull();
    expect(parseSmartPasteUrl("some text")).toBeNull();
  });
});
