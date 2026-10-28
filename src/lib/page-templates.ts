import { z } from "zod";
import { TEMPLATE_ICONS, type TemplateIcon } from "@/lib/template-icons";
export { validateTemplateContent } from "./template-validation";

export { TEMPLATE_ICONS, type TemplateIcon };
export const TEMPLATE_FORMAT = "notebook-page-template" as const;
export const TEMPLATE_FORMAT_VERSION = 2 as const;

export const templateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  icon: z.enum(TEMPLATE_ICONS).default("file-text"),
  content: z.unknown().optional(),
  sourcePageId: z.string().min(1).optional(),
}).strict().refine((input) => !(input.content !== undefined && input.sourcePageId), "Укажите content или sourcePageId");
export const templateUpdateSchema = z.object({ expectedUpdatedAt: z.iso.datetime(), name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable(), icon: z.enum(TEMPLATE_ICONS), content: z.unknown() }).partial().strict();
export const templateReorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200).refine((ids) => new Set(ids).size === ids.length) }).strict();
export const templateImportSchema = z.object({ format: z.literal(TEMPLATE_FORMAT), version: z.union([z.literal(1), z.literal(TEMPLATE_FORMAT_VERSION)]), template: z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable(), icon: z.enum(TEMPLATE_ICONS), content: z.unknown() }).strict() }).strict();
