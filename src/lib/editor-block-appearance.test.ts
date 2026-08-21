import { describe, expect, it } from "vitest";
import { BLOCK_BACKGROUND_TOKENS, blockBackgroundTokenSchema } from "./editor-block-appearance";

describe("block appearance tokens", () => {
  it("accepts only the curated semantic palette", () => {
    expect(BLOCK_BACKGROUND_TOKENS).toEqual(["default", "gray", "red", "orange", "yellow", "green", "blue", "purple"]);
    expect(blockBackgroundTokenSchema.parse("blue")).toBe("blue");
    expect(() => blockBackgroundTokenSchema.parse("#ff00ff")).toThrow();
  });
});

