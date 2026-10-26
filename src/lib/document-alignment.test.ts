import { describe, expect, it } from "vitest";
import { resolveDocumentAlignment } from "./document-alignment";

describe("document alignment preference", () => {
  it.each([undefined, null, "", "justify", "auto", {}, 1])("defaults an absent or invalid saved preference to left (%j)", (value) => {
    expect(resolveDocumentAlignment(value)).toBe("left");
  });
  it.each(["left", "center"] as const)("preserves %s", (value) => {
    expect(resolveDocumentAlignment(value)).toBe(value);
  });
});
