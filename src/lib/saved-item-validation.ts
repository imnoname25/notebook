import { z } from "zod";
import { hashtagQuery, MAX_PAGE_TAGS } from "@/lib/hashtags";

export const MAX_SAVED_ATTACHMENTS = 4;
export const MAX_SAVED_JSON_BYTES = 512 * 1024;
export const MAX_SAVED_MULTIPART_BYTES = 32 * 1024 * 1024;

const nonNullText = (max: number) => z.string().max(max).refine(value => !value.includes("\0"));
const tag = z.string().trim().max(65).transform(value => hashtagQuery(`#${value.replace(/^#/, "")}`))
  .pipe(z.string());
export const savedItemIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const savedItemTitleOriginSchema = z.enum(["system", "manual", "share", "legacy"]);
export const sharedTitleSchema = nonNullText(200).transform(value => value.trim()).pipe(z.string().min(1));
const fields = {
  title: nonNullText(200).transform(value => value.trim()),
  tags: z.array(tag).max(MAX_PAGE_TAGS).transform(tags => [...new Set(tags)].sort()),
};

export const savedItemCreateSchema = z.strictObject({
  ...fields,
  title: fields.title.default(""),
  tags: fields.tags.default([]),
  sharedTitle: sharedTitleSchema.optional(),
  text: nonNullText(50_000).default(""),
  url: nonNullText(2048).transform(value => value.trim()).refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Требуется HTTP(S) URL без учётных данных").nullable().default(null),
});

export const savedItemReviewStatusSchema = z.enum(["pending", "reviewed"]);
export const savedItemUpdateSchema = z.strictObject({
  ...fields,
  reviewStatus: savedItemReviewStatusSchema,
  archived: z.boolean(),
  useWebsiteTitle: z.literal(true),
}).partial().refine(value => Object.keys(value).length > 0 && !(value.useWebsiteTitle && value.title !== undefined));

export const savedItemListSchema = z.strictObject({
  archive: z.enum(["active", "archived", "all"]).default("active"),
  reviewStatus: savedItemReviewStatusSchema.optional(),
  tag: tag.optional(),
  q: z.string().trim().max(300).refine(value => !value.includes("\0")).default(""),
  cursor: savedItemIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const savedItemConvertSchema = z.strictObject({ sectionId: savedItemIdSchema });
export const savedItemIdempotencyKeySchema = z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/);

export type SavedItemCreateInput = z.infer<typeof savedItemCreateSchema>;
export type SavedItemUpdateInput = z.infer<typeof savedItemUpdateSchema>;
export type SavedItemListInput = z.infer<typeof savedItemListSchema>;
