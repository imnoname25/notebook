import { z } from "zod";

export const DEFAULT_STICKER_SIZE = { width: 320, height: 340 };
export const stickerSizeSchema = z.object({ width: z.number().finite().min(260).max(640), height: z.number().finite().min(260).max(800) });
export type StickerSize = z.infer<typeof stickerSizeSchema>;
export function clampStickerSize(width: number, height: number): StickerSize {
  return { width: Math.round(Math.max(260, Math.min(640, width))), height: Math.round(Math.max(260, Math.min(800, height))) };
}
export function stickerSizeKey(userId: string, noteId: string) { return `notebook:sticker-size:v1:${encodeURIComponent(userId)}:${encodeURIComponent(noteId)}`; }
