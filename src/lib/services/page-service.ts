import { validateTemplateContent } from "@/lib/page-templates";
import { cloneBlocksWithFreshIds } from "@/lib/document-state";
import { materializeTemplateContent } from "./template-service";
import { PAGE_APPEARANCE_PRESETS, pagePresetAppearance, valueFromAllowlist } from "@/lib/content-appearance";
import { Prisma } from "@/generated/prisma/client";
import { ApiError } from "@/lib/errors";
import { db } from "@/lib/db";
import { extractBlockNoteText } from "@/lib/blocknote-text";
import { createPageSnapshot } from "@/lib/services/page-version-service";
import { syncPageTags } from "@/lib/services/tag-service";
import { syncPageLinks } from "@/lib/services/page-link-service";
import { syncLiveWidgetIndex } from "@/lib/services/live-widget-service";
import { lockOwnedPage } from "./page-write-lock";

export type PageSaveInput = {
  title?: string;
  content?: Record<string, unknown>[];
  isFavorite?: boolean;
  icon?: string | null;
  color?: string;
  coverUploadId?: string | null;
  backgroundType?: string;
  backgroundColor?: string;
  backgroundGradient?: string | null;
  backgroundPattern?: string;
  backgroundUploadId?: string | null;
  backgroundPosition?: string;
  backgroundOverlay?: string;
  appearancePreset?: string | null;
  expectedRevision?: number;
  snapshotReason?: "interval" | "manual";
};

export async function savePage(userId: string, pageId: string, input: PageSaveInput) {
  return db.$transaction(async (tx) => {
    await lockOwnedPage(tx, userId, pageId);
    const page = await tx.page.findFirst({
      where: { id: pageId, deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } },
      select: { id: true, title: true, content: true, searchText: true, revision: true },
    });
    if (!page) throw new ApiError(404, "Страница не найдена");
    if ((input.title !== undefined || input.content !== undefined) && input.expectedRevision === undefined) throw new ApiError(409, "Для изменения документа требуется актуальная revision. Обновите документ перед сохранением");
    if (input.expectedRevision !== undefined && input.expectedRevision !== page.revision) throw new ApiError(409, "Страница была изменена в другой операции");

    const nextTitle = input.title ?? page.title;
    const nextContent = input.content ?? page.content;
    const documentChanged = page.title !== nextTitle || JSON.stringify(page.content) !== JSON.stringify(nextContent);
    if (documentChanged || input.snapshotReason === "manual") await createPageSnapshot(tx, page, input.snapshotReason ?? "interval");

    if (input.coverUploadId) {
      const cover = await tx.upload.findFirst({ where: { id: input.coverUploadId, userId, pageId }, select: { id: true } });
      if (!cover) throw new ApiError(400, "Обложка должна принадлежать этой странице");
    }
    if (input.backgroundUploadId) {
      const background = await tx.upload.findFirst({ where: { id: input.backgroundUploadId, userId, pageId }, select: { id: true } });
      if (!background) throw new ApiError(400, "Фон должен принадлежать этой странице");
    }
    const data: Prisma.PageUpdateInput = {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.isFavorite === undefined ? {} : { isFavorite: input.isFavorite }),
      ...(input.icon === undefined ? {} : { icon: input.icon }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.coverUploadId === undefined ? {} : { coverUpload: input.coverUploadId ? { connect: { id: input.coverUploadId } } : { disconnect: true } }),
      ...(input.backgroundType === undefined ? {} : { backgroundType: input.backgroundType }),
      ...(input.backgroundColor === undefined ? {} : { backgroundColor: input.backgroundColor }),
      ...(input.backgroundGradient === undefined ? {} : { backgroundGradient: input.backgroundGradient }),
      ...(input.backgroundPattern === undefined ? {} : { backgroundPattern: input.backgroundPattern }),
      ...(input.backgroundUploadId === undefined ? {} : { backgroundUpload: input.backgroundUploadId ? { connect: { id: input.backgroundUploadId } } : { disconnect: true } }),
      ...(input.backgroundPosition === undefined ? {} : { backgroundPosition: input.backgroundPosition }),
      ...(input.backgroundOverlay === undefined ? {} : { backgroundOverlay: input.backgroundOverlay }),
      ...(input.appearancePreset === undefined ? {} : { appearancePreset: input.appearancePreset }),
      ...(input.content === undefined ? {} : { content: input.content as Prisma.InputJsonValue, searchText: extractBlockNoteText(input.content) }),
      ...(documentChanged ? { revision: { increment: 1 } } : {}),
    };
    const saved = await tx.page.update({ where: { id: pageId }, data });
    if (documentChanged) {
      await syncPageTags(tx, userId, pageId, `${nextTitle} ${extractBlockNoteText(nextContent)}`);
      await syncPageLinks(tx, userId, pageId, nextContent);
      await syncLiveWidgetIndex(tx, pageId, nextContent);
    }
    return saved;
  });
}

export async function createPage(userId: string, input: { sectionId: string; title?: string; templateId?: string }) {
  const section = await db.section.findFirst({ where: { id: input.sectionId, deletedAt: null, notebook: { userId, deletedAt: null } }, select: { id: true } });
  if (!section) throw new ApiError(404, "Раздел не найден");
  const template = input.templateId ? await db.pageTemplate.findFirst({ where: { id: input.templateId, userId }, select: { name: true, content: true } }) : null;
  if (input.templateId && !template) throw new ApiError(404, "Шаблон не найден");
  const content = template ? validateTemplateContent(template.content) : [{ type: "paragraph", content: [] }];
  const preferences = await db.userSettings.findUnique({ where: { userId }, select: { defaultPagePreset: true } });
  const preset = valueFromAllowlist(preferences?.defaultPagePreset, PAGE_APPEARANCE_PRESETS, "default");
  const appearance = pagePresetAppearance(preset);
  const last = await db.page.aggregate({ where: { sectionId: input.sectionId, deletedAt: null }, _max: { sortOrder: true } });
  const page = await db.$transaction(async (tx) => {
    const pageContent = template ? cloneBlocksWithFreshIds(await materializeTemplateContent(userId, content, tx)) : content;
    const created = await tx.page.create({ data: { sectionId: input.sectionId, title: input.title ?? template?.name ?? "Без названия", sortOrder: (last._max.sortOrder ?? -1) + 1, content: pageContent as Prisma.InputJsonValue, searchText: extractBlockNoteText(pageContent), ...appearance } });
    await syncPageTags(tx, userId, created.id, `${created.title} ${created.searchText}`);
    await syncPageLinks(tx, userId, created.id, created.content);
    await syncLiveWidgetIndex(tx, created.id, created.content);
    return created;
  });
  return page;
}
