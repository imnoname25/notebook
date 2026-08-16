import { z } from "zod";
import { NOTEBOOK_COLORS, NOTEBOOK_ICONS } from "@/lib/notebook-appearance";
import { ACCENT_COLORS, isPageIcon } from "@/lib/content-appearance";

const title = z.string().trim().min(1).max(200);
export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(128),
});
export const setupSchema = credentialsSchema.extend({ name: z.string().trim().min(1).max(100) });
export const twoFactorCodeSchema = z.object({ code: z.string().trim().min(6).max(32) }).strict();
export const twoFactorSetupSchema = z.object({ password: z.string().min(8).max(128) }).strict();
export const twoFactorDisableSchema = twoFactorSetupSchema.extend({ code: z.string().trim().min(6).max(32) }).strict();
export const notebookCreateSchema = z.object({ title, icon: z.enum(NOTEBOOK_ICONS).optional(), color: z.enum(NOTEBOOK_COLORS).optional() }).strict();
export const notebookUpdateSchema = notebookCreateSchema.partial().strict();
export const sectionCreateSchema = z.object({ notebookId: z.string().min(1), parentId: z.string().min(1).nullable().optional(), title, icon: z.string().max(40).nullable().optional(), color: z.enum(ACCENT_COLORS).optional() });
export const sectionUpdateSchema = z.object({ title, icon: z.string().max(40).nullable(), color: z.enum(ACCENT_COLORS), parentId: z.string().min(1).nullable() }).partial().strict();
export const pageCreateSchema = z.object({ sectionId: z.string().min(1), title: title.optional(), templateId: z.string().min(1).optional() }).strict();
export const pageUpdateSchema = z.object({ title, content: z.array(z.record(z.string(), z.unknown())), isFavorite: z.boolean(), icon: z.string().max(16).nullable().refine(isPageIcon, "Некорректная иконка"), color: z.enum(ACCENT_COLORS), coverUploadId: z.string().min(1).nullable(), expectedRevision: z.number().int().min(0), snapshotReason: z.enum(["interval", "manual"]) }).partial().strict();
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
