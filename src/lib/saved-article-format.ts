import { z } from "zod";
import { metadataUrl } from "./saved-metadata-network";

export const SAVED_ARTICLE_CONTENT_VERSION = 1;
export const SAVED_ARTICLE_IMAGE_VERSION = 2;
export const MAX_ARTICLE_IMAGES = 8;
export const MAX_ARTICLE_BLOCKS = 400;
export const MAX_ARTICLE_INLINE = 200;
export const MAX_ARTICLE_INLINE_TEXT = 16_384;
export const MAX_ARTICLE_LIST_DEPTH = 12;
const MAX_ARTICLE_TEXT = 200_000;

const text = z.string().min(1).max(MAX_ARTICLE_INLINE_TEXT).refine(value => !value.includes("\0"));
const href = z.string().max(2048).refine(value => {
  try { metadataUrl(value); return true; } catch { return false; }
});
const inline = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text }),
  z.strictObject({ type: z.literal("link"), text, href }),
]);
const content = z.array(inline).min(1).max(MAX_ARTICLE_INLINE);
export const savedArticleImageKey = z.string().regex(/^[a-f0-9]{64}$/u);
export const savedArticleBlocks = z.array(z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("paragraph"), content }),
  z.strictObject({ type: z.literal("heading"), level: z.number().int().min(1).max(6), content }),
  z.strictObject({ type: z.literal("quote"), content }),
  z.strictObject({
    type: z.literal("listItem"), ordered: z.boolean(), depth: z.number().int().min(0).max(MAX_ARTICLE_LIST_DEPTH), content,
  }),
  z.strictObject({ type: z.literal("image"), key: savedArticleImageKey, alt: z.string().max(300) }),
])).min(1).max(MAX_ARTICLE_BLOCKS).refine(blocks =>
  blocks.filter(block => block.type === "image").length <= MAX_ARTICLE_IMAGES &&
  blocks.reduce((size, block) => size + (block.type === "image" ? block.alt.length : block.content.reduce((sum, part) =>
    sum + part.text.length + (part.type === "link" ? part.href.length : 0), 0)), 0) <= MAX_ARTICLE_TEXT);

export type SavedArticleBlocks = z.infer<typeof savedArticleBlocks>;
