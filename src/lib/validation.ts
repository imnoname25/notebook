import { z } from "zod";
import { NOTEBOOK_COLORS, NOTEBOOK_ICONS } from "@/lib/notebook-appearance";
import { ACCENT_COLORS, isPageIcon, PAGE_APPEARANCE_PRESETS, PAGE_BACKGROUND_OVERLAYS, PAGE_BACKGROUND_POSITIONS, PAGE_BACKGROUND_TYPES, PAGE_GRADIENTS, PAGE_LIST_VIEWS, PAGE_PATTERNS, SECTION_ACCENT_INTENSITIES } from "@/lib/content-appearance";
import { SECTION_ICONS } from "@/lib/section-icons";
import { NOTEBOOK_COVER_GRADIENTS, NOTEBOOK_COVER_TYPES } from "@/lib/notebook-cover";

const title = z.string().trim().min(1).max(200);
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: passwordSchema,
});
export const setupSchema = credentialsSchema.extend({ name: z.string().trim().min(1).max(100) });
export const twoFactorCodeSchema = z.object({ code: z.string().trim().min(6).max(32) }).strict();
export const twoFactorSetupSchema = z.object({ password: z.string().min(8).max(128) }).strict();
export const twoFactorDisableSchema = twoFactorSetupSchema.extend({ code: z.string().trim().min(6).max(32) }).strict();
export const notebookCreateSchema = z.object({ title, icon: z.enum(NOTEBOOK_ICONS).optional(), color: z.enum(NOTEBOOK_COLORS).optional() }).strict();
export const notebookUpdateSchema = notebookCreateSchema.partial().extend({
  coverType: z.enum(NOTEBOOK_COVER_TYPES).optional(),
  coverValue: z.enum([...NOTEBOOK_COVER_GRADIENTS, ...NOTEBOOK_COLORS]).nullable().optional(),
  coverUploadId: z.string().min(1).nullable().optional(),
}).strict();
export const sectionCreateSchema = z.object({ notebookId: z.string().min(1), parentId: z.string().min(1).nullable().optional(), title, icon: z.enum(SECTION_ICONS).nullable().optional(), color: z.enum(ACCENT_COLORS).optional() }).strict();
export const sectionUpdateSchema = z.object({ title, icon: z.enum(SECTION_ICONS).nullable(), color: z.enum(ACCENT_COLORS), parentId: z.string().min(1).nullable() }).partial().strict();
export const recentPageSchema = z.object({ pageId: z.string().min(1) }).strict();
export const recentListSchema = z.object({ limit: z.coerce.number().int().min(1).max(20).default(12), notebookId: z.string().min(1).optional() });
export const pageCreateSchema = z.object({ sectionId: z.string().min(1), title: title.optional(), templateId: z.string().min(1).optional() }).strict();
export const pageUpdateSchema = z.object({
  title, content: z.array(z.record(z.string(), z.unknown())), isFavorite: z.boolean(),
  icon: z.string().max(16).nullable().refine(isPageIcon, "Некорректная иконка"), color: z.enum(ACCENT_COLORS), coverUploadId: z.string().min(1).nullable(),
  backgroundType: z.enum(PAGE_BACKGROUND_TYPES), backgroundColor: z.enum(ACCENT_COLORS), backgroundGradient: z.enum(PAGE_GRADIENTS).nullable(),
  backgroundPattern: z.enum(PAGE_PATTERNS), backgroundUploadId: z.string().min(1).nullable(), backgroundPosition: z.enum(PAGE_BACKGROUND_POSITIONS),
  backgroundOverlay: z.enum(PAGE_BACKGROUND_OVERLAYS), appearancePreset: z.enum(PAGE_APPEARANCE_PRESETS).nullable(),
  expectedRevision: z.number().int().min(0), snapshotReason: z.enum(["interval", "manual"]),
}).partial().strict();
export const pageMoveSchema = z.object({ destinationSectionId: z.string().min(1) });
export const sectionMoveSchema = z.object({ destinationNotebookId: z.string().min(1) });
export const versionListSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(25), cursor: z.string().min(1).optional() });
export const restoreVersionSchema = z.object({ expectedRevision: z.number().int().min(0) });

const orderedIds = z.array(z.string().min(1)).min(1).max(500).refine((ids) => new Set(ids).size === ids.length, "ID не должны повторяться");
export const notebookReorderSchema = z.object({ ids: orderedIds });
export const sectionReorderSchema = z.object({ notebookId: z.string().min(1), parentId: z.string().min(1).nullable(), ids: orderedIds });
export const pageReorderSchema = z.object({ sectionId: z.string().min(1), ids: orderedIds });
export const trashItemSchema = z.object({ type: z.enum(["notebook", "section", "page"]), id: z.string().min(1) });
export const searchQuerySchema = z.string().trim().min(2).max(300);
export const searchRequestSchema = z.object({ q: searchQuerySchema, offset: z.coerce.number().int().min(0).max(250).default(0) });
export const quickNoteColors = ["neutral", "amber", "orange", "green", "blue", "violet", "pink"] as const;
export const quickNoteCreateSchema = z.object({
  title: z.string().trim().max(120).optional(),
  body: z.string().max(10_000).optional(),
  color: z.enum(quickNoteColors).optional(),
  icon: z.string().max(16).nullable().optional().refine((value) => value === undefined || isPageIcon(value), "Некорректная иконка"),
}).strict();
export const quickNoteUpdateSchema = quickNoteCreateSchema.extend({
  isPinned: z.boolean().optional(),
  archived: z.boolean().optional(),
}).strict();
export const quickNoteConvertSchema = z.object({ sectionId: z.string().min(1) }).strict();
export const tagListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  tag: z.string().trim().min(1).max(80).optional(),
});

export const accountPasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
}).strict();

export const accountProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
}).strict();

export const accountPreferencesSchema = z.object({
  interfaceDensity: z.enum(["comfortable", "compact"]).optional(),
  editorSpellcheck: z.boolean().optional(),
  editorCodeLineNumbers: z.boolean().optional(),
  editorCompactMode: z.boolean().optional(),
  editorContentWidth: z.enum(["narrow", "normal", "wide"]).optional(),
  sectionAccentIntensity: z.enum(SECTION_ACCENT_INTENSITIES).optional(),
  pageListView: z.enum(PAGE_LIST_VIEWS).optional(),
  defaultPagePreset: z.enum(PAGE_APPEARANCE_PRESETS).optional(),
  startScreen: z.enum(["last", "today", "notebooks", "inbox"]).optional(),
}).strict();

export const userRoleSchema = z.enum(["ADMIN", "USER"]);
export const adminUserCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: userRoleSchema.default("USER"),
  password: passwordSchema,
  mustChangePassword: z.boolean().default(true),
}).strict();

export const adminUserUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: userRoleSchema,
}).strict();

export const adminUserActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("disable") }).strict(),
  z.object({ action: z.literal("enable") }).strict(),
  z.object({ action: z.literal("revokeSessions") }).strict(),
  z.object({ action: z.literal("resetTwoFactor") }).strict(),
  z.object({ action: z.literal("resetPassword"), password: passwordSchema, mustChangePassword: z.boolean().default(true) }).strict(),
]);
