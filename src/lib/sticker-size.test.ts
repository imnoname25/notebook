import { describe, expect, it } from "vitest";
import { clampStickerSize, DEFAULT_STICKER_SIZE, stickerSizeKey, stickerSizeSchema } from "./sticker-size";

describe("sticker presentation sizes", () => {
  it("bounds dimensions without making controls unusable", () => {
    expect(clampStickerSize(10, 100)).toEqual({ width: 260, height: 260 });
    expect(clampStickerSize(1000, 2000)).toEqual({ width: 640, height: 800 });
    expect(clampStickerSize(350.6, 410.2)).toEqual({ width: 351, height: 410 });
  });
  it("validates stored preferences and rejects invalid payloads", () => {
    expect(stickerSizeSchema.safeParse(DEFAULT_STICKER_SIZE).success).toBe(true);
    for (const value of [null, { width: "320", height: 340 }, { width: -1, height: 340 }, { width: 320, height: Infinity }]) expect(stickerSizeSchema.safeParse(value).success).toBe(false);
  });
  it("isolates account and sticker preferences", () => {
    expect(stickerSizeKey("user1", "note")).not.toBe(stickerSizeKey("user2", "note"));
    expect(stickerSizeKey("user1", "note")).not.toBe(stickerSizeKey("user1", "other"));
  });
});
