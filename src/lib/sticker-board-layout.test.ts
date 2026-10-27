import { describe, expect, it } from "vitest";
import { addBoardCards, arrangeCards, boardLayoutKey, boardLayoutSchema, boardPoint, frontCard, overlap, type BoardLayout } from "./sticker-board-layout";

describe("device-scoped sticker canvas geometry", () => {
  it("places legacy cards without overlaps and preserves individual dimensions", () => {
    const cards = addBoardCards(["a", "b", "c"], {}, 1000, id => id === "a" ? { width: 600, height: 700 } : null);
    expect(cards.a).toMatchObject({ width: 600, height: 700 });expect(cards.b).toMatchObject({ width: 320, height: 340 });
    expect(overlap(cards.a!, cards.b!)).toBe(false);expect(overlap(cards.b!, cards.c!)).toBe(false);expect(overlap(cards.a!, cards.c!)).toBe(false);
  });
  it("adds a new sticker without rearranging existing coordinates", () => {
    const first = addBoardCards(["a", "b"], {}, 800, () => null);
    const second = addBoardCards(["a", "b", "new"], first, 600, () => null);
    expect(second.a).toEqual(first.a);expect(second.b).toEqual(first.b);
    expect(overlap(second.new!, second.a!)).toBe(false);expect(overlap(second.new!, second.b!)).toBe(false);
    expect(addBoardCards(["a", "b"], first, 400, () => null)).toEqual(first);
  });
  it("allows complete overlap and normalizes layering without unbounded growth", () => {
    let cards: BoardLayout = { a: { x: 16, y: 16, width: 320, height: 340, z: 1 }, b: { x: 16, y: 16, width: 320, height: 340, z: 2 } };
    expect(boardLayoutSchema.safeParse({ version: 1, cards }).success).toBe(true);
    for (let i = 0; i < 1000; i++) cards = frontCard(cards, i % 2 ? "a" : "b");
    expect(cards.a!.z).toBe(2);expect(cards.b!.z).toBe(1);expect(cards.a!.x).toBe(16);expect(cards.b!.y).toBe(16);
  });
  it("arranges only on explicit request, retaining sizes and predictable order", () => {
    const original = { a: { x: 900, y: 800, width: 600, height: 700, z: 2 }, b: { x: 900, y: 800, width: 320, height: 340, z: 1 } };
    const packed = arrangeCards(["b", "a"], original, 800);
    expect(packed.b).toMatchObject({ x: 16, y: 16, width: 320, height: 340 });expect(packed.a).toMatchObject({ width: 600, height: 700 });
    expect(overlap(packed.a!, packed.b!)).toBe(false);expect(original.a.x).toBe(900);
    expect(arrangeCards(["b", "a"], original, 800)).toEqual(packed);
  });
  it("keeps account keys distinct and rejects malformed stored layouts", () => {
    expect(boardLayoutKey("one")).not.toBe(boardLayoutKey("two"));
    expect(boardLayoutSchema.safeParse({ version: 1, cards: { a: { x: -5, y: 0, width: 320, height: 340, z: 1 } } }).success).toBe(false);
    expect(boardLayoutSchema.safeParse({ version: 7, cards: {} }).success).toBe(false);
    expect(boardPoint(-100)).toBe(0);expect(boardPoint(90000)).toBe(30000);
  });
});
