import { z } from "zod";
import { blockNoteContentSchema } from "@/lib/data-format";
import { attachmentIdsInContent } from "@/lib/portable-content";
import { ApiError } from "@/lib/errors";
import { TEMPLATE_ICONS, type TemplateIcon } from "@/lib/template-icons";

export { TEMPLATE_ICONS, type TemplateIcon };
export const TEMPLATE_FORMAT = "notebook-page-template" as const;
export const TEMPLATE_FORMAT_VERSION = 1 as const;

const allowedBlockTypes = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock", "image", "table", "callout", "toggle", "divider"]);

function hasUnsafeValue(value: unknown): boolean {
  if (typeof value === "string") return /(?:<\s*script|javascript\s*:|data\s*:|blob\s*:)/iu.test(value);
  if (Array.isArray(value)) return value.some(hasUnsafeValue);
  return Boolean(value && typeof value === "object" && Object.values(value).some(hasUnsafeValue));
}

export function validateTemplateContent(value: unknown) {
  const content = blockNoteContentSchema.parse(value);
  const visit = (blocks: typeof content) => {
    for (const block of blocks) {
      if (!allowedBlockTypes.has(block.type)) throw new ApiError(400, `Блок ${block.type} не поддерживается в шаблонах`);
      const children = (block as Record<string, unknown>).children;
      if (Array.isArray(children)) visit(blockNoteContentSchema.parse(children));
    }
  };
  visit(content);
  if (hasUnsafeValue(content)) throw new ApiError(400, "Шаблон содержит небезопасную ссылку или HTML");
  if (attachmentIdsInContent(content).size > 0) throw new ApiError(409, "Сначала удалите private изображения: шаблоны пока не копируют файлы вложений");
  return content;
}

export const templateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  icon: z.enum(TEMPLATE_ICONS).default("file-text"),
  content: z.unknown().optional(),
  sourcePageId: z.string().min(1).optional(),
}).strict().refine((input) => !(input.content !== undefined && input.sourcePageId), "Укажите content или sourcePageId");
export const templateUpdateSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable(), icon: z.enum(TEMPLATE_ICONS), content: z.unknown() }).partial().strict();
export const templateReorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200).refine((ids) => new Set(ids).size === ids.length) }).strict();
export const templateImportSchema = z.object({ format: z.literal(TEMPLATE_FORMAT), version: z.literal(TEMPLATE_FORMAT_VERSION), template: z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable(), icon: z.enum(TEMPLATE_ICONS), content: z.unknown() }).strict() }).strict();
