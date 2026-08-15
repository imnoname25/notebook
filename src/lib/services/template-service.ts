import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { TEMPLATE_FORMAT, TEMPLATE_FORMAT_VERSION, type TemplateIcon, validateTemplateContent } from "@/lib/page-templates";

const builtIns: { key: string; name: string; description: string; icon: TemplateIcon; content: Record<string, unknown>[] }[] = [
  { key: "blank", name: "Пустая страница", description: "Чистый лист", icon: "file-text", content: [{ type: "paragraph", content: [] }] },
  { key: "note", name: "Заметка", description: "Тема и основные мысли", icon: "notebook", content: [{ type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Основная мысль", styles: {} }] }, { type: "paragraph", content: [] }, { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Детали", styles: {} }] }, { type: "bulletListItem", content: [] }] },
  { key: "meeting", name: "Встреча", description: "Повестка, заметки и решения", icon: "calendar", content: [{ type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Повестка", styles: {} }] }, { type: "bulletListItem", content: [] }, { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Решения", styles: {} }] }, { type: "checkListItem", props: { checked: false }, content: [] }] },
  { key: "instruction", name: "Инструкция", description: "Последовательность действий", icon: "book-open", content: [{ type: "callout", props: { kind: "info", title: "Цель" }, content: [] }, { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Шаги", styles: {} }] }, { type: "numberedListItem", content: [] }] },
  { key: "project", name: "Проект", description: "Краткое описание и следующие шаги", icon: "briefcase", content: [{ type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Описание", styles: {} }] }, { type: "paragraph", content: [] }, { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Следующие шаги", styles: {} }] }, { type: "checkListItem", props: { checked: false }, content: [] }] },
  { key: "checklist", name: "Чек-лист", description: "Простой список для проверки", icon: "list-checks", content: [{ type: "checkListItem", props: { checked: false }, content: [] }, { type: "checkListItem", props: { checked: false }, content: [] }] },
  { key: "journal", name: "Журнал", description: "Наблюдения и итоги дня", icon: "lightbulb", content: [{ type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Сегодня", styles: {} }] }, { type: "paragraph", content: [] }, { type: "toggle", props: { open: true }, content: [{ type: "text", text: "Итоги", styles: {} }], children: [{ type: "paragraph", content: [] }] }] },
];

export async function ensureBuiltInTemplates(userId: string) {
  await db.$transaction(builtIns.map((item, index) => db.pageTemplate.upsert({
    where: { userId_builtInKey: { userId, builtInKey: item.key } },
    create: { userId, builtInKey: item.key, isBuiltIn: true, name: item.name, description: item.description, icon: item.icon, content: item.content as Prisma.InputJsonValue, sortOrder: index },
    update: {},
  })));
}

export async function listTemplates(userId: string) {
  await ensureBuiltInTemplates(userId);
  return db.pageTemplate.findMany({ where: { userId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
}

export async function createTemplate(userId: string, input: { name: string; description?: string | null; icon: TemplateIcon; content?: unknown; sourcePageId?: string }) {
  let content: unknown = input.content ?? [{ type: "paragraph", content: [] }];
  if (input.sourcePageId) {
    const page = await db.page.findFirst({ where: { id: input.sourcePageId, deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } }, select: { content: true } });
    if (!page) throw new ApiError(404, "Страница не найдена"); content = page.content;
  }
  const valid = validateTemplateContent(content);
  const last = await db.pageTemplate.aggregate({ where: { userId }, _max: { sortOrder: true } });
  return db.pageTemplate.create({ data: { userId, name: input.name, description: input.description ?? null, icon: input.icon, content: valid as Prisma.InputJsonValue, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
}

export async function updateTemplate(userId: string, id: string, input: { name?: string; description?: string | null; icon?: TemplateIcon; content?: unknown }) {
  const template = await db.pageTemplate.findFirst({ where: { id, userId } });
  if (!template) throw new ApiError(404, "Шаблон не найден");
  if (template.isBuiltIn) throw new ApiError(409, "Встроенный шаблон нельзя изменять; сначала создайте копию");
  const data: Prisma.PageTemplateUpdateInput = { ...(input.name === undefined ? {} : { name: input.name }), ...(input.description === undefined ? {} : { description: input.description }), ...(input.icon === undefined ? {} : { icon: input.icon }), ...(input.content === undefined ? {} : { content: validateTemplateContent(input.content) as Prisma.InputJsonValue }) };
  return db.pageTemplate.update({ where: { id }, data });
}

export async function duplicateTemplate(userId: string, id: string) {
  const template = await db.pageTemplate.findFirst({ where: { id, userId } });
  if (!template) throw new ApiError(404, "Шаблон не найден");
  return createTemplate(userId, { name: `${template.name} — копия`, description: template.description, icon: template.icon as TemplateIcon, content: template.content });
}

export async function deleteTemplate(userId: string, id: string) {
  const template = await db.pageTemplate.findFirst({ where: { id, userId }, select: { id: true, isBuiltIn: true } });
  if (!template) throw new ApiError(404, "Шаблон не найден");
  if (template.isBuiltIn) throw new ApiError(409, "Встроенный шаблон нельзя удалить");
  await db.pageTemplate.delete({ where: { id } });
}

export async function reorderTemplates(userId: string, ids: string[]) {
  const owned = await db.pageTemplate.findMany({ where: { userId }, select: { id: true } });
  if (owned.length !== ids.length || owned.some((item) => !ids.includes(item.id))) throw new ApiError(400, "Порядок должен содержать все шаблоны пользователя");
  await db.$transaction(ids.map((id, sortOrder) => db.pageTemplate.update({ where: { id }, data: { sortOrder } })));
}

export async function templateExport(userId: string, id: string) {
  const template = await db.pageTemplate.findFirst({ where: { id, userId } });
  if (!template) throw new ApiError(404, "Шаблон не найден");
  return { format: TEMPLATE_FORMAT, version: TEMPLATE_FORMAT_VERSION, template: { name: template.name, description: template.description, icon: template.icon, content: template.content } };
}
