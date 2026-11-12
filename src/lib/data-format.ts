import { z } from "zod";
import { blockNoteContentSchema } from "./blocknote-content-schema";
export { blockNoteContentSchema } from "./blocknote-content-schema";
import { MAX_ARTICLE_IMAGES, savedArticleBlocks, savedArticleImageKey } from "./saved-article-format";
import { NOTEBOOK_COLORS, NOTEBOOK_ICONS } from "@/lib/notebook-appearance";
import { TEMPLATE_ICONS } from "@/lib/template-icons";
import { SECTION_ICONS } from "@/lib/section-icons";
import { NOTEBOOK_COVER_GRADIENTS, NOTEBOOK_COVER_TYPES } from "@/lib/notebook-cover";
import { hashtagQuery, MAX_PAGE_TAGS } from "@/lib/hashtags";
import { MAX_SAVED_ATTACHMENTS, savedItemCreateSchema, savedItemReviewStatusSchema, savedItemTitleOriginSchema, sharedTitleSchema } from "@/lib/saved-item-validation";
import {
  ACCENT_COLORS,
  PAGE_APPEARANCE_PRESETS,
  PAGE_BACKGROUND_OVERLAYS,
  PAGE_BACKGROUND_POSITIONS,
  PAGE_BACKGROUND_TYPES,
  PAGE_GRADIENTS,
  PAGE_PATTERNS,
} from "@/lib/content-appearance";

export const DATA_FORMAT_VERSION = 7 as const;
export const SAVED_ITEMS_DATA_FORMAT_VERSION = 6 as const;
export const FILE_INTEGRITY_DATA_FORMAT_VERSION = 6 as const;
export const ARTICLES_DATA_FORMAT_VERSION = 7 as const;
const SECTION_ICONS_DATA_FORMAT_VERSION = 5 as const;
export const LINKS_DATA_FORMAT_VERSION = 4 as const;
export const APPEARANCE_DATA_FORMAT_VERSION = 3 as const;
export const PREVIOUS_DATA_FORMAT_VERSION = 2 as const;
export const LEGACY_DATA_FORMAT_VERSION = 1 as const;
export const EXPORT_FORMAT = "notebook-export" as const;
export const PAGE_FORMAT = "notebook-page" as const;
export const BACKUP_FORMAT = "notebook-backup" as const;

const portableDate = z.iso.datetime();
const portableAttachmentSchema = z
  .object({
    key: z.string().min(1).max(100),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(100),
    size: z.number().int().min(0),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    archivePath: z.string().min(1).max(500).optional(),
    dataBase64: z.string().optional(),
  })
  .strict();
const portableVersionSchema = z
  .object({
    title: z.string().min(1).max(200),
    content: blockNoteContentSchema,
    searchText: z.string(),
    contentHash: z.string(),
    reason: z.string().max(40),
    createdAt: portableDate,
  })
  .strict();
const portablePageSchema = z
  .object({
    key: z.string().min(1).max(100),
    title: z.string().min(1).max(200),
    icon: z.string().max(16).nullable().optional(),
    color: z.enum(ACCENT_COLORS).optional(),
    coverAttachmentKey: z.string().min(1).max(100).nullable().optional(),
    backgroundType: z.enum(PAGE_BACKGROUND_TYPES).optional(),
    backgroundColor: z.enum(ACCENT_COLORS).optional(),
    backgroundGradient: z.enum(PAGE_GRADIENTS).nullable().optional(),
    backgroundPattern: z.enum(PAGE_PATTERNS).optional(),
    backgroundAttachmentKey: z.string().min(1).max(100).nullable().optional(),
    backgroundPosition: z.enum(PAGE_BACKGROUND_POSITIONS).optional(),
    backgroundOverlay: z.enum(PAGE_BACKGROUND_OVERLAYS).optional(),
    appearancePreset: z.enum(PAGE_APPEARANCE_PRESETS).nullable().optional(),
    content: blockNoteContentSchema,
    sortOrder: z.number().int().min(0),
    isFavorite: z.boolean().default(false),
    createdAt: portableDate,
    updatedAt: portableDate,
    deletedAt: portableDate.nullable().optional(),
    deletionGroup: z.string().nullable().optional(),
    isDeletionRoot: z.boolean().optional(),
    versions: z.array(portableVersionSchema).max(100).optional(),
  })
  .strict();
const portableSectionSchema = z
  .object({
    key: z.string().min(1).max(100),
    parentKey: z.string().min(1).max(100).nullable(),
    title: z.string().min(1).max(200),
    icon: z.enum(SECTION_ICONS).nullable(),
    color: z.enum(ACCENT_COLORS).optional(),
    sortOrder: z.number().int().min(0),
    createdAt: portableDate,
    updatedAt: portableDate,
    deletedAt: portableDate.nullable().optional(),
    deletionGroup: z.string().nullable().optional(),
    isDeletionRoot: z.boolean().optional(),
    pages: z.array(portablePageSchema).max(100_000),
  })
  .strict();
const portableNotebookSchema = z
  .object({
    key: z.string().min(1).max(100),
    title: z.string().min(1).max(200),
    icon: z.enum(NOTEBOOK_ICONS),
    color: z.enum(NOTEBOOK_COLORS),
    coverType: z.enum(NOTEBOOK_COVER_TYPES).optional(),
    coverValue: z.union([z.enum(NOTEBOOK_COVER_GRADIENTS), z.enum(NOTEBOOK_COLORS)]).nullable().optional(),
    coverAttachmentKey: z.string().min(1).max(100).nullable().optional(),
    sortOrder: z.number().int().min(0),
    createdAt: portableDate,
    updatedAt: portableDate,
    deletedAt: portableDate.nullable().optional(),
    deletionGroup: z.string().nullable().optional(),
    isDeletionRoot: z.boolean().optional(),
    sections: z.array(portableSectionSchema).max(10_000),
  })
  .strict();
const portableTemplateSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).nullable(),
    icon: z.enum(TEMPLATE_ICONS),
    content: blockNoteContentSchema,
    sortOrder: z.number().int().min(0),
  })
  .strict();
const portableQuickNoteSchema = z.object({
  title: z.string().max(120),
  body: z.string().max(10_000),
  color: z.enum(["neutral", "amber", "orange", "green", "blue", "violet", "pink"]),
  icon: z.string().max(16).nullable(),
  isPinned: z.boolean(),
  sortOrder: z.number().int().min(0).optional(),
  status: z.enum(["INBOX", "ARCHIVED", "CONVERTED"]).optional(),
  archivedAt: portableDate.nullable(),
  createdAt: portableDate,
  updatedAt: portableDate,
}).strict();

const portableKey = z.string().min(1).max(100);
const portableTag = z.strictObject({
  name: z.string().min(1).max(128),
  normalized: z.string().min(1).max(128),
}).refine(({ name, normalized }) =>
  !name.includes("\0") && hashtagQuery(`#${normalized}`) === normalized &&
  hashtagQuery(`#${name}`) === normalized);
const portableMetadataText = (max: number) => z.string().max(max).refine(value => !value.includes("\0")).nullable();
export const portableArticleSchema = z.strictObject({
  contentVersion: z.union([z.literal(1), z.literal(2)]),
  blocks: savedArticleBlocks,
  sourceUrl: savedItemCreateSchema.shape.url.unwrap().unwrap(),
  extractedAt: portableDate,
  images: z.array(z.strictObject({
    imageKey: savedArticleImageKey,
    sourceUrl: savedItemCreateSchema.shape.url.unwrap().unwrap(),
    position: z.number().int().min(0).max(MAX_ARTICLE_IMAGES - 1),
    attachmentKey: portableKey.nullable(),
  })).max(MAX_ARTICLE_IMAGES),
}).superRefine((article, ctx) => {
  const keys = article.blocks.flatMap(block => block.type === "image" ? [block.key] : []);
  const images = new Set(article.images.map(image => image.imageKey));
  if (images.size !== article.images.length || new Set(keys).size !== keys.length ||
      new Set(article.images.map(image => image.position)).size !== article.images.length ||
      keys.length !== images.size || keys.some(key => !images.has(key)) ||
      (article.contentVersion === 1 && keys.length))
    ctx.addIssue({ code: "custom", message: "Invalid article image references" });
});
const portableSavedItemSchema = z.strictObject({
  ...savedItemCreateSchema.pick({ text: true, url: true }).required().shape,
  title: z.string().max(200).refine(value => !value.includes("\0")),
  titleOrigin: savedItemTitleOriginSchema.optional(),
  sharedTitle: sharedTitleSchema.nullable().optional(),
  key: portableKey,
  reviewStatus: savedItemReviewStatusSchema,
  archivedAt: portableDate.nullable(),
  convertedAt: portableDate.nullable(),
  convertedPageKey: portableKey.nullable(),
  createdAt: portableDate,
  updatedAt: portableDate,
  tags: z.array(portableTag).max(MAX_PAGE_TAGS),
  attachmentKeys: z.array(portableKey).max(MAX_SAVED_ATTACHMENTS),
  article: portableArticleSchema.nullable().optional(),
  metadata: z.strictObject({
    title: portableMetadataText(300),
    description: portableMetadataText(1000),
    siteName: portableMetadataText(253),
    imageUrl: savedItemCreateSchema.shape.url,
  }),
}).refine(item => item.titleOrigin === undefined ? item.sharedTitle === undefined
  : item.titleOrigin === "share" ? Boolean(item.sharedTitle)
  : item.titleOrigin === "system" || Boolean(item.title));

export const manifestSchema = z
  .object({
    format: z.enum([EXPORT_FORMAT, BACKUP_FORMAT]),
    version: z.union([
      z.literal(LEGACY_DATA_FORMAT_VERSION),
      z.literal(PREVIOUS_DATA_FORMAT_VERSION),
      z.literal(APPEARANCE_DATA_FORMAT_VERSION),
      z.literal(LINKS_DATA_FORMAT_VERSION),
      z.literal(SECTION_ICONS_DATA_FORMAT_VERSION),
      z.literal(SAVED_ITEMS_DATA_FORMAT_VERSION),
      z.literal(DATA_FORMAT_VERSION),
    ]),
    createdAt: portableDate,
    app: z.literal("Notebook"),
    scope: z.enum(["notebook", "all", "backup"]),
    includesHistory: z.boolean(),
    attachmentCount: z.number().int().min(0),
  })
  .strict();
export const archiveDataSchema = z
  .object({
    notebooks: z.array(portableNotebookSchema).max(10_000),
    attachments: z.array(portableAttachmentSchema).max(10_000),
    templates: z.array(portableTemplateSchema).max(500).optional(),
    quickNotes: z.array(portableQuickNoteSchema).max(10_000).optional(),
    savedItems: z.array(portableSavedItemSchema).max(100_000).optional(),
  })
  .strict();
export const pageExportSchema = z
  .object({
    manifest: z
      .object({
        format: z.literal(PAGE_FORMAT),
        version: z.union([
          z.literal(LEGACY_DATA_FORMAT_VERSION),
          z.literal(PREVIOUS_DATA_FORMAT_VERSION),
          z.literal(APPEARANCE_DATA_FORMAT_VERSION),
          z.literal(LINKS_DATA_FORMAT_VERSION),
          z.literal(SECTION_ICONS_DATA_FORMAT_VERSION),
          z.literal(SAVED_ITEMS_DATA_FORMAT_VERSION),
          z.literal(DATA_FORMAT_VERSION),
        ]),
        createdAt: portableDate,
        app: z.literal("Notebook"),
      })
      .strict(),
    page: portablePageSchema.omit({ versions: true }),
    attachments: z.array(portableAttachmentSchema).max(500),
  })
  .strict();

export type PortableAttachment = z.infer<typeof portableAttachmentSchema>;
export type PortablePage = z.infer<typeof portablePageSchema>;
export type PortableSection = z.infer<typeof portableSectionSchema>;
export type PortableNotebook = z.infer<typeof portableNotebookSchema>;
export type ArchiveData = z.infer<typeof archiveDataSchema>;
export type DataManifest = z.infer<typeof manifestSchema>;
export type PageExport = z.infer<typeof pageExportSchema>;
