import { randomUUID } from "node:crypto";
import { lstat, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { resolveSavedItemTitle } from "@/lib/saved-item-title";
import {
  BACKUP_FORMAT,
  archiveDataSchema,
  blockNoteContentSchema,
  DATA_FORMAT_VERSION,
  EXPORT_FORMAT,
  PAGE_FORMAT,
  type ArchiveData,
  type DataManifest,
  type PageExport,
  type PortableAttachment,
  type PortableNotebook,
} from "@/lib/data-format";
import {
  attachmentIdsInContent,
  rewriteAttachmentReferences,
  rewriteInternalPageReferences,
} from "@/lib/portable-content";
import {
  resolveStoragePath,
  safeDownloadName,
  sha256File,
} from "@/lib/storage";
import { blockNoteToMarkdown } from "@/lib/markdown-export";
import { assertSafeArchivePath, createDataTempDirectory, createZipArchive } from "@/lib/archive";
import { MAX_IMPORT_ENTRIES, MAX_IMPORT_JSON_BYTES, maxImportArchiveBytes, maxImportUncompressedBytes } from "@/lib/data-limits";
import { ATTACHMENT_EXTENSIONS, isValidAttachmentMime } from "@/lib/uploads";
import { lockUserUploads } from "./upload-service";
import { blockNoteToSafeHtml, standalonePageHtml } from "@/lib/html-export";
import { TEMPLATE_ICONS, type TemplateIcon } from "@/lib/template-icons";
import { portableTemplateReferences } from "@/lib/template-portability";
import { isSectionIcon } from "@/lib/section-icons";

type ExportOptions = {
  notebookId?: string;
  includeDeleted: boolean;
  includeHistory: boolean;
  backup: boolean;
};
type ExportBuild = {
  manifest: DataManifest;
  data: ArchiveData;
  attachmentFiles: Map<string, string>;
};

function date(value: Date) {
  return value.toISOString();
}
function jsonBlocks(value: Prisma.JsonValue) {
  return blockNoteContentSchema.parse(value);
}
function templateIcon(value: string): TemplateIcon {
  if (!(TEMPLATE_ICONS as readonly string[]).includes(value))
    throw new ApiError(409, "Шаблон содержит неизвестную иконку");
  return value as TemplateIcon;
}
function portableBlocks(
  value: Prisma.JsonValue,
  attachmentMapping: ReadonlyMap<string, string>,
  pageMapping: ReadonlyMap<string, string>,
) {
  return blockNoteContentSchema.parse(
    rewriteInternalPageReferences(
      rewriteAttachmentReferences(
        jsonBlocks(value),
        attachmentMapping,
        "export",
      ),
      pageMapping,
      "export",
    ),
  );
}

export async function buildPortableExport(
  userId: string,
  options: ExportOptions,
  client: Prisma.TransactionClient = db,
): Promise<ExportBuild> {
  const notebooks = await client.notebook.findMany({
    where: {
      userId,
      ...(options.notebookId ? { id: options.notebookId } : {}),
      ...(options.includeDeleted ? {} : { deletedAt: null }),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      sections: {
        where: options.includeDeleted ? {} : { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          pages: {
            where: options.includeDeleted ? {} : { deletedAt: null },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            include: {
              versions: options.includeHistory
                ? { orderBy: { createdAt: "asc" } }
                : false,
            },
          },
        },
      },
    },
  });
  if (options.notebookId && notebooks.length === 0)
    throw new ApiError(404, "Блокнот не найден");
  const attachmentIds = new Set<string>();
  for (const notebook of notebooks) {
    if (notebook.coverUploadId) attachmentIds.add(notebook.coverUploadId);
    for (const section of notebook.sections)
      for (const page of section.pages) {
        if (page.coverUploadId) attachmentIds.add(page.coverUploadId);
        if (page.backgroundUploadId) attachmentIds.add(page.backgroundUploadId);
        attachmentIdsInContent(page.content).forEach((id) =>
          attachmentIds.add(id),
        );
        if (options.includeHistory)
          page.versions.forEach((version) =>
            attachmentIdsInContent(version.content).forEach((id) =>
              attachmentIds.add(id),
            ),
          );
      }
  }
  const savedItems = options.notebookId ? [] : await client.savedItem.findMany({
    where: { userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      tags: { where: { tag: { userId } }, orderBy: { tag: { normalized: "asc" } }, include: { tag: true } },
      attachments: { orderBy: { position: "asc" }, include: { upload: { select: { originalName: true } } } },
    },
  });
  for (const item of savedItems) {
    for (const attachment of item.attachments) attachmentIds.add(attachment.uploadId);
  }
  const uploads = await client.upload.findMany({
    where: options.backup
      ? { userId }
      : { userId, id: { in: [...attachmentIds] } },
    orderBy: { createdAt: "asc" },
  });
  const availableUploadIds = new Set(uploads.map(upload => upload.id));
  if ([...attachmentIds].some(id => !availableUploadIds.has(id)))
    throw new ApiError(409, "Некоторые вложения отсутствуют в metadata");
  const uploadKey = new Map(
    uploads.map((upload, index) => [upload.id, `attachment-${index + 1}`]),
  );
  const notebookKey = new Map(
    notebooks.map((notebook, index) => [notebook.id, `notebook-${index + 1}`]),
  );
  const sections = notebooks.flatMap((notebook) => notebook.sections);
  const sectionKey = new Map(
    sections.map((section, index) => [section.id, `section-${index + 1}`]),
  );
  const pages = sections.flatMap((section) => section.pages);
  const pageKey = new Map(
    pages.map((page, index) => [page.id, `page-${index + 1}`]),
  );
  const deletionGroups = new Map<string, string>();
  let deletionIndex = 0;
  const portableGroup = (group: string | null) => {
    if (!group) return null;
    if (!deletionGroups.has(group))
      deletionGroups.set(group, `deletion-${++deletionIndex}`);
    return deletionGroups.get(group)!;
  };
  const portableNotebooks: PortableNotebook[] = notebooks.map((notebook) => ({
    key: notebookKey.get(notebook.id)!,
    title: notebook.title,
    icon: notebook.icon as PortableNotebook["icon"],
    color: notebook.color as PortableNotebook["color"],
    coverType: notebook.coverType as PortableNotebook["coverType"],
    coverValue: notebook.coverValue as PortableNotebook["coverValue"],
    coverAttachmentKey: notebook.coverUploadId ? (uploadKey.get(notebook.coverUploadId) ?? null) : null,
    sortOrder: notebook.sortOrder,
    createdAt: date(notebook.createdAt),
    updatedAt: date(notebook.updatedAt),
    ...(options.backup
      ? {
          deletedAt: notebook.deletedAt ? date(notebook.deletedAt) : null,
          deletionGroup: portableGroup(notebook.deletionGroupId),
          isDeletionRoot: notebook.isDeletionRoot,
        }
      : {}),
    sections: notebook.sections.map((section) => ({
      key: sectionKey.get(section.id)!,
      parentKey: section.parentId
        ? (sectionKey.get(section.parentId) ?? null)
        : null,
      title: section.title,
      icon: isSectionIcon(section.icon) ? section.icon : null,
      color: section.color as PortableNotebook["sections"][number]["color"],
      sortOrder: section.sortOrder,
      createdAt: date(section.createdAt),
      updatedAt: date(section.updatedAt),
      ...(options.backup
        ? {
            deletedAt: section.deletedAt ? date(section.deletedAt) : null,
            deletionGroup: portableGroup(section.deletionGroupId),
            isDeletionRoot: section.isDeletionRoot,
          }
        : {}),
      pages: section.pages.map((page) => ({
        key: pageKey.get(page.id)!,
        title: page.title,
        icon: page.icon,
        color:
          page.color as PortableNotebook["sections"][number]["pages"][number]["color"],
        coverAttachmentKey: page.coverUploadId
          ? (uploadKey.get(page.coverUploadId) ?? null)
          : null,
        backgroundType:
          page.backgroundType as PortableNotebook["sections"][number]["pages"][number]["backgroundType"],
        backgroundColor:
          page.backgroundColor as PortableNotebook["sections"][number]["pages"][number]["backgroundColor"],
        backgroundGradient:
          page.backgroundGradient as PortableNotebook["sections"][number]["pages"][number]["backgroundGradient"],
        backgroundPattern:
          page.backgroundPattern as PortableNotebook["sections"][number]["pages"][number]["backgroundPattern"],
        backgroundAttachmentKey: page.backgroundUploadId
          ? (uploadKey.get(page.backgroundUploadId) ?? null)
          : null,
        backgroundPosition:
          page.backgroundPosition as PortableNotebook["sections"][number]["pages"][number]["backgroundPosition"],
        backgroundOverlay:
          page.backgroundOverlay as PortableNotebook["sections"][number]["pages"][number]["backgroundOverlay"],
        appearancePreset:
          page.appearancePreset as PortableNotebook["sections"][number]["pages"][number]["appearancePreset"],
        content: portableBlocks(page.content, uploadKey, pageKey),
        sortOrder: page.sortOrder,
        isFavorite: page.isFavorite,
        createdAt: date(page.createdAt),
        updatedAt: date(page.updatedAt),
        ...(options.backup
          ? {
              deletedAt: page.deletedAt ? date(page.deletedAt) : null,
              deletionGroup: portableGroup(page.deletionGroupId),
              isDeletionRoot: page.isDeletionRoot,
              versions: page.versions.map((version) => ({
                title: version.title,
                content: portableBlocks(version.content, uploadKey, pageKey),
                searchText: version.searchText,
                contentHash: version.contentHash,
                reason: version.reason,
                createdAt: date(version.createdAt),
              })),
            }
          : {}),
      })),
    })),
  }));
  const attachmentFiles = new Map<string, string>();
  const portableAttachments: PortableAttachment[] = [];
  if (uploads.length + 2 > MAX_IMPORT_ENTRIES || uploads.reduce((sum, upload) => sum + upload.size, 0) > maxImportUncompressedBytes())
    throw new ApiError(413, "Вложения превышают ограничения архива");
  for (const upload of uploads) {
    const key = uploadKey.get(upload.id)!;
    const source = resolveStoragePath(upload.storageName);
    let hash: string;
    try {
      const info = await lstat(source);
      if (!info.isFile() || info.size !== upload.size) throw new Error("size");
      const handle = await open(source, "r");
      const header = Buffer.alloc(12);
      try {
        const { bytesRead } = await handle.read(header);
        if (!isValidAttachmentMime(upload.mimeType, header.subarray(0, bytesRead))) throw new Error("MIME");
      } finally {
        await handle.close();
      }
      hash = await sha256File(source);
      if (upload.sha256 && upload.sha256 !== hash) throw new Error("SHA-256");
    } catch {
      throw new ApiError(
        409,
        `Файл вложения отсутствует или повреждён: ${upload.originalName}`,
      );
    }
    const archivePath = `attachments/${key}.${ATTACHMENT_EXTENSIONS[upload.mimeType]}`;
    assertSafeArchivePath(archivePath);
    portableAttachments.push({
      key,
      fileName: safeDownloadName(upload.originalName),
      mimeType: upload.mimeType,
      size: upload.size,
      sha256: hash,
      archivePath,
    });
    attachmentFiles.set(archivePath, source);
  }
  const templates = options.backup
    ? await client.pageTemplate.findMany({
        where: { userId, isBuiltIn: false },
        orderBy: { sortOrder: "asc" },
      })
    : [];
  const quickNotes = options.notebookId
    ? []
    : await client.quickNote.findMany({
        where: { userId },
        orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
      });
  const manifest: DataManifest = {
    format: options.backup ? BACKUP_FORMAT : EXPORT_FORMAT,
    version: DATA_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    app: "Notebook",
    scope: options.backup ? "backup" : options.notebookId ? "notebook" : "all",
    includesHistory: options.includeHistory,
    attachmentCount: portableAttachments.length,
  };
  return {
    manifest,
    data: {
      notebooks: portableNotebooks,
      attachments: portableAttachments,
      ...(options.backup
        ? {
            templates: templates.map((template) => ({
              name: template.name,
              description: template.description,
              icon: templateIcon(template.icon),
              content: blockNoteContentSchema.parse(portableTemplateReferences(jsonBlocks(template.content), pageKey)),
              sortOrder: template.sortOrder,
            })),
          }
        : {}),
      ...(!options.notebookId
        ? {
            savedItems: savedItems.map((item, index) => ({
              key: `saved-item-${index + 1}`,
              title: resolveSavedItemTitle({ ...item, fileName: item.attachments[0]?.upload.originalName }),
              ...(item.titleOrigin === "legacy" && !item.sharedTitle ? {}
                : { titleOrigin: item.titleOrigin, sharedTitle: item.sharedTitle }),
              text: item.text,
              url: item.url,
              reviewStatus: item.reviewStatus,
              archivedAt: item.archivedAt && date(item.archivedAt),
              convertedAt: item.convertedAt && date(item.convertedAt),
              convertedPageKey: item.convertedPageId ? pageKey.get(item.convertedPageId) ?? null : null,
              createdAt: date(item.createdAt),
              updatedAt: date(item.updatedAt),
              tags: item.tags.map(({ tag: { name, normalized } }) => ({ name, normalized })),
              attachmentKeys: item.attachments.map(({ uploadId }) => uploadKey.get(uploadId)!),
              metadata: {
                title: item.metadataTitle,
                description: item.metadataDescription,
                siteName: item.metadataSiteName,
                imageUrl: item.metadataImageUrl,
              },
            })),
            quickNotes: quickNotes.map((note) => ({
              title: note.title,
              body: note.body,
              color: note.color as "neutral" | "amber" | "orange" | "green" | "blue" | "violet" | "pink",
              icon: note.icon,
              isPinned: note.isPinned,
              sortOrder: note.sortOrder,
              status: note.status,
              archivedAt: note.archivedAt ? date(note.archivedAt) : null,
              createdAt: date(note.createdAt),
              updatedAt: date(note.updatedAt),
            })),
          }
        : {}),
    },
    attachmentFiles,
  };
}

export async function writePortableArchive(
  userId: string,
  target: string,
  options: ExportOptions,
) {
  return db.$transaction(async (tx) => {
    await lockUserUploads(tx, userId);
    const built = await buildPortableExport(userId, options, tx);
    const manifest = JSON.stringify(built.manifest, null, 2);
    const data = JSON.stringify(archiveDataSchema.parse(built.data));
    const jsonBytes = Buffer.byteLength(data);
    if (jsonBytes > MAX_IMPORT_JSON_BYTES ||
        jsonBytes + Buffer.byteLength(manifest) + built.data.attachments.reduce((sum, file) => sum + file.size, 0) > maxImportUncompressedBytes())
      throw new ApiError(413, "Данные превышают ограничения архива");
    await createZipArchive(target, async (archive) => {
      archive.append(manifest, { name: "manifest.json" });
      archive.append(data, { name: options.backup ? "backup.json" : "notebook.json" });
      for (const [archivePath, source] of built.attachmentFiles)
        archive.file(source, { name: archivePath });
    });
    if ((await stat(target)).size > maxImportArchiveBytes()) {
      await rm(target, { force: true });
      throw new ApiError(413, "Архив превышает допустимый размер");
    }
    return built.manifest;
  }, { timeout: 120_000 });
}

export async function exportPageJson(
  userId: string,
  pageId: string,
): Promise<PageExport> {
  const page = await db.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      section: { deletedAt: null, notebook: { userId, deletedAt: null } },
    },
  });
  if (!page) throw new ApiError(404, "Страница не найдена");
  const ids = new Set(attachmentIdsInContent(page.content));
  if (page.coverUploadId) ids.add(page.coverUploadId);
  if (page.backgroundUploadId) ids.add(page.backgroundUploadId);
  const uploads = await db.upload.findMany({
    where: { userId, id: { in: [...ids] } },
  });
  if (uploads.length !== ids.size)
    throw new ApiError(409, "Некоторые вложения страницы отсутствуют");
  const keys = new Map(
    uploads.map((upload, index) => [upload.id, `attachment-${index + 1}`]),
  );
  const attachments: PortableAttachment[] = [];
  for (const upload of uploads) {
    const source = resolveStoragePath(upload.storageName);
    const bytes = await readFile(source);
    attachments.push({
      key: keys.get(upload.id)!,
      fileName: safeDownloadName(upload.originalName),
      mimeType: upload.mimeType,
      size: upload.size,
      sha256: upload.sha256 ?? (await sha256File(source)),
      dataBase64: bytes.toString("base64"),
    });
  }
  return {
    manifest: {
      format: PAGE_FORMAT,
      version: DATA_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      app: "Notebook",
    },
    page: {
      key: randomUUID(),
      title: page.title,
      icon: page.icon,
      color:
        page.color as PortableNotebook["sections"][number]["pages"][number]["color"],
      coverAttachmentKey: page.coverUploadId
        ? (keys.get(page.coverUploadId) ?? null)
        : null,
      backgroundType:
        page.backgroundType as PageExport["page"]["backgroundType"],
      backgroundColor:
        page.backgroundColor as PageExport["page"]["backgroundColor"],
      backgroundGradient:
        page.backgroundGradient as PageExport["page"]["backgroundGradient"],
      backgroundPattern:
        page.backgroundPattern as PageExport["page"]["backgroundPattern"],
      backgroundAttachmentKey: page.backgroundUploadId
        ? (keys.get(page.backgroundUploadId) ?? null)
        : null,
      backgroundPosition:
        page.backgroundPosition as PageExport["page"]["backgroundPosition"],
      backgroundOverlay:
        page.backgroundOverlay as PageExport["page"]["backgroundOverlay"],
      appearancePreset:
        page.appearancePreset as PageExport["page"]["appearancePreset"],
      content: portableBlocks(page.content, keys, new Map()),
      sortOrder: 0,
      isFavorite: false,
      createdAt: date(page.createdAt),
      updatedAt: date(page.updatedAt),
    },
    attachments,
  };
}

export async function exportPageMarkdown(userId: string, pageId: string) {
  const page = await db.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      section: { deletedAt: null, notebook: { userId, deletedAt: null } },
    },
    select: { title: true, content: true },
  });
  if (!page) throw new ApiError(404, "Страница не найдена");
  return {
    title: page.title,
    markdown: blockNoteToMarkdown(page.title, jsonBlocks(page.content)),
  };
}

export async function exportPageHtmlArchive(userId: string, pageId: string) {
  const page = await db.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      section: { deletedAt: null, notebook: { userId, deletedAt: null } },
    },
    select: { title: true, content: true, updatedAt: true },
  });
  if (!page) throw new ApiError(404, "Страница не найдена");
  const ids = [...attachmentIdsInContent(page.content)];
  const uploads = await db.upload.findMany({
    where: { userId, id: { in: ids } },
  });
  if (uploads.length !== ids.length)
    throw new ApiError(409, "Некоторые вложения страницы отсутствуют");
  const fileById = new Map(
    uploads.map((upload, index) => [
      upload.id,
      {
        archivePath: `attachments/${index + 1}-${safeDownloadName(upload.originalName)}`,
        source: resolveStoragePath(upload.storageName),
      },
    ]),
  );
  const html = standalonePageHtml(
    page.title,
    page.updatedAt,
    blockNoteToSafeHtml(jsonBlocks(page.content), (url) => {
      const id = url.match(/^\/api\/uploads\/([A-Za-z0-9_-]+)$/u)?.[1];
      if (id) return fileById.get(id)?.archivePath ?? null;
      return /^https?:\/\//iu.test(url) ? url : null;
    }),
  );
  const directory = await createDataTempDirectory("notebook-html-export-");
  const filePath = path.join(
    directory,
    `${safeDownloadName(page.title)}-html.zip`,
  );
  await createZipArchive(filePath, async (archive) => {
    archive.append(html, { name: "index.html" });
    for (const file of fileById.values())
      archive.file(file.source, { name: file.archivePath });
  });
  return { title: page.title, directory, filePath };
}
