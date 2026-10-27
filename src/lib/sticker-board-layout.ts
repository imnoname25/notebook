import { z } from "zod";
import { DEFAULT_STICKER_SIZE, stickerSizeSchema } from "./sticker-size";

export const boardCardSchema = stickerSizeSchema.extend({ x: z.number().finite().min(0).max(30000), y: z.number().finite().min(0).max(30000), z: z.number().int().min(1).max(10001) });
export type BoardCard = z.infer<typeof boardCardSchema>;
export type BoardLayout = Record<string, BoardCard>;
export const boardLayoutSchema = z.object({ version: z.literal(1), cards: z.record(z.string().max(200), boardCardSchema).refine(cards => Object.keys(cards).length <= 10000) });
export const boardLayoutKey = (userId: string) => `notebook:sticker-board:v4:${encodeURIComponent(userId)}`;
export function boardPoint(value: number) { return Math.round(Math.max(0, Math.min(30000, value))); }
export function overlap(a: BoardCard, b: BoardCard, gap = 0) { return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y; }
export function frontCard(cards: BoardLayout, id: string): BoardLayout {
  const order = Object.keys(cards).sort((a, b) => cards[a]!.z - cards[b]!.z || a.localeCompare(b));
  return Object.fromEntries([...order.filter(key => key !== id), ...(cards[id] ? [id] : [])].map((key, index) => [key, { ...cards[key]!, z: index + 1 }]));
}
export function arrangeCards(ids: string[], cards: BoardLayout, availableWidth: number): BoardLayout {
  let x = 16, y = 16, row = 0;const next = { ...cards };
  for (const id of ids) {
    const card = cards[id];if (!card) continue;
    if (x > 16 && x + card.width + 16 > availableWidth) { x = 16;y += row + 16;row = 0; }
    next[id] = { ...card, x, y };x += card.width + 16;row = Math.max(row, card.height);
  }
  return next;
}
export function addBoardCards(ids: string[], cards: BoardLayout, width: number, legacySize: (id: string) => unknown): BoardLayout {
  const next = { ...cards };
  const visibleIds = new Set(ids);
  for (const id of ids) {
    if (next[id]) continue;
    const parsed = stickerSizeSchema.safeParse(legacySize(id));
    const card: BoardCard = { ...(parsed.success ? parsed.data : DEFAULT_STICKER_SIZE), x: 16, y: 16, z: Object.keys(next).length + 1 };
    const occupied = Object.entries(next).filter(([key]) => visibleIds.has(key)).map(([, value]) => value);
    // Candidate edges find an available position without moving existing cards.
    const rows = [...new Set([16, ...occupied.map(item => item.y + item.height + 16)])].sort((a, b) => a - b);
    const columns = [...new Set([16, ...occupied.map(item => item.x + item.width + 16)])].sort((a, b) => a - b);
    let placed = false;
    for (const y of rows) {
      for (const x of columns) {
        if (x > 16 && x + card.width + 16 > width) continue;
        card.x = x;card.y = y;
        if (!occupied.some(item => overlap(card, item, 15))) { placed = true;break; }
      }
      if (placed) break;
    }
    card.x = boardPoint(card.x);card.y = boardPoint(card.y);next[id] = card;
  }
  return next;
}
