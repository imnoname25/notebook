import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import {
  archiveDataSchema,
  BACKUP_FORMAT,
  blockNoteContentSchema,
  EXPORT_FORMAT,
  DATA_FORMAT_VERSION,
  manifestSchema,
  pageExportSchema,
  type ArchiveData,
  type DataManifest,
  type PageExport,
  type PortableAttachment,
} from "@/lib/data-format";
import {
  assertSafeArchivePath,
  createDataTempDirectory,
  detectImportKind,
  extractZipSafely,
  readJsonFile,
  writeRequestToFile,
} from "@/lib/archive";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { extractBlockNoteText } from "@/lib/blocknote-text";
import { syncPageTags, syncQuickNoteTags } from "@/lib/services/tag-service";
import { syncPageLinks } from "@/lib/services/page-link-service";
import { syncLiveWidgetIndex } from "@/lib/services/live-widget-service";
import { ATTACHMENT_EXTENSIONS, isValidAttachmentMime } from "@/lib/uploads";
import { discardUncommittedUploads, lockUserUploads } from "./upload-service";
import {
  portableAttachmentKeysInContent,
  rewriteAttachmentReferences,
  rewriteInternalPageReferences,
} from "@/lib/portable-content";
import {
  resolveStoragePath,
  safeDownloadName,
  sha256File,
} from "@/lib/storage";
import { pageContentHash } from "@/lib/page-version-policy";
import { restoreTemplateReferences, templateReferenceWarnings } from "@/lib/template-portability";
import { validateTemplateContent } from "@/lib/page-templates";

export type ImportSummary = {
  kind: "page" | "notebook" | "all" | "backup";
  title: string;
  notebooks: number;
  sections: number;
  pages: number;
  savedItems?: number;
  attachments: number;
  totalBytes: number;
  warnings?: string[];
};
export type PreparedImport = {
  directory: string;
  sourcePath: string;
  page?: PageExport;
  manifest?: DataManifest;
  data?: ArchiveData;
  summary: ImportSummary;
};

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const next = path.posix.join(relative.replace(/\\/g, "/"), entry.name);
    if (entry.isSymbolicLink())
      throw new ApiError(400, "Symlink в архиве запрещён");
    if (entry.isDirectory()) result.push(...(await listFiles(root, next)));
    else if (entry.isFile()) result.push(next);
  }
  return result;
}

function hashBytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function assertPortableReferences(data: ArchiveData, manifest: DataManifest) {
  const keys = [data.notebooks.map(n => n.key), data.notebooks.flatMap(n => n.sections.map(s => s.key)), data.notebooks.flatMap(n => n.sections.flatMap(s => s.pages.map(p => p.key))), data.attachments.map(a => a.key), (data.savedItems ?? []).map(item => item.key)];
  if (keys.some(group => new Set(group).size !== group.length)) throw new ApiError(400, "Повторяющиеся portable keys в архиве");
  const available = new Set(
    data.attachments.map((attachment) => attachment.key),
  );
  for (const item of data.savedItems ?? []) {
    if (!item.title && !item.text.trim() && !item.url && !item.attachmentKeys.length)
      throw new ApiError(400, "Пустой материал в архиве");
    if (new Set(item.tags.map(tag => tag.normalized)).size !== item.tags.length ||
        new Set(item.attachmentKeys).size !== item.attachmentKeys.length ||
        item.attachmentKeys.some(key => !available.has(key)))
      throw new ApiError(400, "Некорректные связи сохранённого материала");
  }
  for (const notebook of data.notebooks) {
    if (notebook.coverAttachmentKey && !available.has(notebook.coverAttachmentKey))
      throw new ApiError(400, "Обложка блокнота ссылается на отсутствующее вложение");
    const parents = new Map(notebook.sections.map(section => [section.key, section.parentKey]));
    const checked = new Set<string>();
    for (const section of notebook.sections) {
      const chain = new Set<string>();
      let key: string | null = section.key;
      while (key !== null && !checked.has(key)) {
        if (!parents.has(key) || chain.has(key))
          throw new ApiError(400, "Некорректная иерархия разделов");
        chain.add(key);
        key = parents.get(key)!;
      }
      for (const entry of chain) checked.add(entry);
    }
  }
  for (const notebook of data.notebooks)
    for (const section of notebook.sections)
      for (const page of section.pages) {
        if (page.coverAttachmentKey && !available.has(page.coverAttachmentKey))
          throw new ApiError(
            400,
            "Обложка ссылается на отсутствующее вложение",
          );
        if (
          page.backgroundAttachmentKey &&
          !available.has(page.backgroundAttachmentKey)
        )
          throw new ApiError(
            400,
            "Фоновое изображение ссылается на отсутствующее вложение",
          );
        for (const key of portableAttachmentKeysInContent(page.content))
          if (!available.has(key))
            throw new ApiError(
              400,
              "Страница ссылается на отсутствующее вложение",
            );
        for (const version of page.versions ?? [])
          for (const key of portableAttachmentKeysInContent(version.content))
            if (!available.has(key))
              throw new ApiError(
                400,
                "История ссылается на отсутствующее вложение",
              );
      }
  if (manifest.format === BACKUP_FORMAT && manifest.version >= 2) {
    const pages = new Map(keys[2].map(key => [key, key]));
    for (const template of data.templates ?? [])
      validateTemplateContent(restoreTemplateReferences(template.content, pages, manifest.version).content);
  }
}

async function validateArchiveFiles(directory: string, data: ArchiveData, dataName: string, requireHash: boolean) {
  const allowed = new Set(["manifest.json", dataName]);
  let total = 0;
  for (const attachment of data.attachments) {
    if (!attachment.archivePath || assertSafeArchivePath(attachment.archivePath) !== attachment.archivePath ||
        !attachment.archivePath.startsWith("attachments/") || allowed.has(attachment.archivePath) || attachment.dataBase64 !== undefined)
      throw new ApiError(400, "Некорректный путь вложения");
    if (requireHash && !attachment.sha256)
      throw new ApiError(400, "Вложение v6 не содержит SHA-256");
    allowed.add(attachment.archivePath);
    const filePath = path.resolve(
      directory,
      ...attachment.archivePath.split("/"),
    );
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile() || info.size !== attachment.size)
      throw new ApiError(400, `Вложение повреждено: ${attachment.fileName}`);
    const hash = await sha256File(filePath);
    if (attachment.sha256 && hash !== attachment.sha256)
      throw new ApiError(400, `SHA-256 не совпадает: ${attachment.fileName}`);
    const handle = await open(filePath, "r");
    const header = Buffer.alloc(12);
    const validMime = await handle.read(header)
      .then(({ bytesRead }) => isValidAttachmentMime(attachment.mimeType, header.subarray(0, bytesRead)))
      .finally(() => handle.close());
    if (!validMime)
      throw new ApiError(
        415,
        `Недопустимый MIME вложения: ${attachment.fileName}`,
      );
    total += info.size;
  }
  const actual = await listFiles(directory);
  if (actual.some((file) => !allowed.has(file)))
    throw new ApiError(400, "Архив содержит неожиданные файлы");
  return total;
}

function summaryFromData(
  manifest: DataManifest,
  data: ArchiveData,
  bytes: number,
): ImportSummary {
  const sections = data.notebooks.flatMap((notebook) => notebook.sections);
  const pages = sections.flatMap((section) => section.pages);
  return {
    kind:
      manifest.format === BACKUP_FORMAT
        ? "backup"
        : manifest.scope === "notebook"
          ? "notebook"
          : "all",
    title: data.notebooks[0]?.title ?? "Notebook",
    notebooks: data.notebooks.length,
    sections: sections.length,
    pages: pages.length,
    ...(data.savedItems ? { savedItems: data.savedItems.length } : {}),
    attachments: data.attachments.length,
    totalBytes: bytes,
    warnings: templateReferenceWarnings((data.templates ?? []).map(t => t.content), new Map(pages.map(p => [p.key, p.key])), manifest.version),
  };
}

export async function prepareImport(
  request: Request,
  expected: "import" | "backup" = "import",
): Promise<PreparedImport> {
  const directory = await createDataTempDirectory("notebook-import-");
  const sourcePath = path.join(directory, "source.bin");
  try {
    const mediaType =
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() ?? "";
    if (
      mediaType &&
      ![
        "application/zip",
        "application/x-zip-compressed",
        "application/json",
        "application/octet-stream",
      ].includes(mediaType)
    )
      throw new ApiError(415, "Недопустимый MIME архива");
    await writeRequestToFile(request, sourcePath);
    const kind = await detectImportKind(sourcePath);
    if (kind === "json") {
      if (expected === "backup")
        throw new ApiError(400, "Для restore требуется Notebook backup ZIP");
      const page = pageExportSchema.parse(await readJsonFile(sourcePath));
      let total = 0;
      const available = new Set(page.attachments.map((item) => item.key));
      if (
        page.page.coverAttachmentKey &&
        !available.has(page.page.coverAttachmentKey)
      )
        throw new ApiError(400, "Обложка ссылается на отсутствующее вложение");
      if (
        page.page.backgroundAttachmentKey &&
        !available.has(page.page.backgroundAttachmentKey)
      )
        throw new ApiError(
          400,
          "Фоновое изображение ссылается на отсутствующее вложение",
        );
      for (const key of portableAttachmentKeysInContent(page.page.content))
        if (!available.has(key))
          throw new ApiError(
            400,
            "Страница ссылается на отсутствующее вложение",
          );
      for (const attachment of page.attachments) {
        if (!attachment.dataBase64)
          throw new ApiError(400, "Page JSON не содержит данные вложения");
        const bytes = Buffer.from(attachment.dataBase64, "base64");
        if (
          bytes.byteLength !== attachment.size ||
          (attachment.sha256 && hashBytes(bytes) !== attachment.sha256)
        )
          throw new ApiError(400, "Вложение page JSON повреждено");
        if (!isValidAttachmentMime(attachment.mimeType, bytes))
          throw new ApiError(415, "Недопустимый MIME вложения");
        total += bytes.byteLength;
      }
      return {
        directory,
        sourcePath,
        page,
        summary: {
          kind: "page",
          title: page.page.title,
          notebooks: 0,
          sections: 0,
          pages: 1,
          attachments: page.attachments.length,
          totalBytes: total,
        },
      };
    }
    const extracted = path.join(directory, "extracted");
    await mkdir(extracted);
    await extractZipSafely(sourcePath, extracted);
    const manifest = manifestSchema.parse(
      await readJsonFile(path.join(extracted, "manifest.json")),
    );
    if (expected === "backup" && manifest.format !== BACKUP_FORMAT)
      throw new ApiError(400, "Это не резервная копия Notebook");
    if (expected === "import" && manifest.format !== EXPORT_FORMAT)
      throw new ApiError(400, "Backup следует восстанавливать через Restore");
    const dataName =
      manifest.format === BACKUP_FORMAT ? "backup.json" : "notebook.json";
    const data = archiveDataSchema.parse(
      await readJsonFile(path.join(extracted, dataName)),
    );
    if (manifest.attachmentCount !== data.attachments.length)
      throw new ApiError(400, "Manifest не соответствует списку вложений");
    if ((manifest.scope === "backup") !== (manifest.format === BACKUP_FORMAT))
      throw new ApiError(400, "Некорректная область архива");
    const includesSavedItems = manifest.version >= DATA_FORMAT_VERSION && manifest.scope !== "notebook";
    if (includesSavedItems !== (data.savedItems !== undefined))
      throw new ApiError(400, "Состав «Сохранённого» не соответствует версии или области архива");
    assertPortableReferences(data, manifest);
    const bytes = await validateArchiveFiles(extracted, data, dataName, manifest.version >= DATA_FORMAT_VERSION);
    return {
      directory,
      sourcePath,
      manifest,
      data,
      summary: summaryFromData(manifest, data, bytes),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function uniqueImportedTitle(title: string, occupied: Set<string>) {
  if (!occupied.has(title.toLocaleLowerCase("ru"))) {
    occupied.add(title.toLocaleLowerCase("ru"));
    return title;
  }
  let candidate = `${title} (импорт)`;
  let index = 2;
  while (occupied.has(candidate.toLocaleLowerCase("ru")))
    candidate = `${title} (импорт ${index++})`;
  occupied.add(candidate.toLocaleLowerCase("ru"));
  return candidate;
}

async function materializeAttachments(
  userId: string,
  prepared: PreparedImport,
  attachments: PortableAttachment[],
  written: string[],
) {
  const ids = new Map<string, string>();
  const files: {
    id: string;
    storageName: string;
    filePath: string;
    attachment: PortableAttachment;
  }[] = [];
  for (const attachment of attachments) {
    const extension = ATTACHMENT_EXTENSIONS[attachment.mimeType];
    if (!extension) throw new ApiError(415, "Неподдерживаемое вложение");
    const id = randomUUID();
    const storageName = `${userId}/${randomUUID()}.${extension}`;
    const target = resolveStoragePath(storageName);
    await mkdir(path.dirname(target), { recursive: true });
    written.push(storageName);
    if (attachment.dataBase64)
      await writeFile(target, Buffer.from(attachment.dataBase64, "base64"), {
        flag: "wx",
        flush: true,
      });
    else if (attachment.archivePath) {
      await copyFile(
        path.join(
          prepared.directory,
          "extracted",
          ...attachment.archivePath.split("/"),
        ),
        target,
        constants.COPYFILE_EXCL,
      );
      const handle = await open(target, "r+");
      try { await handle.sync(); } finally { await handle.close(); }
    } else throw new ApiError(400, "Данные вложения отсутствуют");
    ids.set(attachment.key, id);
    files.push({ id, storageName, filePath: target, attachment });
  }
  if (files.length && process.platform !== "win32") {
    const userDirectory = path.dirname(files[0].filePath);
    for (const directory of [userDirectory, path.dirname(userDirectory)]) {
      const handle = await open(directory, "r");
      try { await handle.sync(); } finally { await handle.close(); }
    }
  }
  return { ids, files };
}

async function withPortableAttachments<T>(
  userId: string,
  prepared: PreparedImport,
  attachments: PortableAttachment[],
  write: (tx: Prisma.TransactionClient, files: Awaited<ReturnType<typeof materializeAttachments>>) => Promise<T>,
) {
  const written: string[] = [];
  try {
    return await db.$transaction(async tx => {
      await lockUserUploads(tx, userId);
      const materialized = await materializeAttachments(userId, prepared, attachments, written);
      return write(tx, materialized);
    }, { timeout: 120_000 });
  } catch (error) {
    await discardUncommittedUploads(userId, written);
    throw error;
  }
}

async function importSavedItems(
  tx: Prisma.TransactionClient,
  userId: string,
  items: NonNullable<ArchiveData["savedItems"]>,
  attachmentIds: ReadonlyMap<string, string>,
  pageIds: ReadonlyMap<string, string>,
) {
  const tagIds = new Map<string, string>();
  for (const item of items) {
    for (const tag of item.tags) {
      if (tagIds.has(tag.normalized)) continue;
      const { id } = await tx.tag.upsert({
        where: { userId_normalized: { userId, normalized: tag.normalized } },
        create: { userId, ...tag },
        update: {},
        select: { id: true },
      });
      tagIds.set(tag.normalized, id);
    }
    const metadata = item.metadata;
    const titleOrigin = item.titleOrigin ?? (item.title ? "legacy" : "system");
    const hasMetadata = Object.values(metadata).some(value => value !== null);
    const { id } = await tx.savedItem.create({
      data: {
        userId,
        title: titleOrigin === "manual" || titleOrigin === "legacy" ? item.title : "",
        titleOrigin,
        sharedTitle: item.sharedTitle ?? null,
        text: item.text,
        url: item.url,
        reviewStatus: item.reviewStatus,
        archivedAt: item.archivedAt && new Date(item.archivedAt),
        convertedAt: item.convertedAt && new Date(item.convertedAt),
        convertedPageId: item.convertedPageKey ? pageIds.get(item.convertedPageKey) ?? null : null,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
        metadataTitle: metadata.title,
        metadataDescription: metadata.description,
        metadataSiteName: metadata.siteName,
        metadataImageUrl: metadata.imageUrl,
        searchTags: item.tags.map(tag => tag.normalized).join(" "),
        ...(item.url ? { metadataJob: { create: hasMetadata ? { finishedAt: new Date() } : {} } } : {}),
      },
      select: { id: true },
    });
    if (item.tags.length) await tx.savedItemTag.createMany({
      data: item.tags.map(tag => ({ savedItemId: id, tagId: tagIds.get(tag.normalized)! })),
    });
    if (item.attachmentKeys.length) await tx.savedItemAttachment.createMany({
      data: item.attachmentKeys.map((key, position) => ({ savedItemId: id, uploadId: attachmentIds.get(key)!, position })),
    });
  }
}

async function createPortableData(
  tx: Prisma.TransactionClient,
  userId: string,
  data: ArchiveData,
  attachmentIds: Map<string, string>,
  files: Awaited<ReturnType<typeof materializeAttachments>>["files"],
  mode: "import" | "restore",
) {
  const existingTitles = new Set(
    (
      await tx.notebook.findMany({ where: { userId }, select: { title: true } })
    ).map((item) => item.title.toLocaleLowerCase("ru")),
  );
  const notebookIds = new Map<string, string>();
  const sectionIds = new Map<string, string>();
  const pageIds = new Map(
    data.notebooks
      .flatMap((notebook) =>
        notebook.sections.flatMap((section) => section.pages),
      )
      .map((page) => [page.key, randomUUID()]),
  );
  const attachmentPage = new Map<string, string>();
  const pageCovers = new Map<string, string>();
  const pageBackgrounds = new Map<string, string>();
  const notebookCovers = new Map<string, string>();
  for (const notebook of data.notebooks) {
    const id = randomUUID();
    notebookIds.set(notebook.key, id);
    await tx.notebook.create({
      data: {
        id,
        userId,
        title:
          mode === "import"
            ? uniqueImportedTitle(notebook.title, existingTitles)
            : notebook.title,
        icon: notebook.icon,
        color: notebook.color,
        coverType: notebook.coverType ?? "none",
        coverValue: notebook.coverValue ?? null,
        sortOrder: notebook.sortOrder,
        createdAt: new Date(notebook.createdAt),
        updatedAt: new Date(notebook.updatedAt),
        ...(mode === "restore"
          ? {
              deletedAt: notebook.deletedAt
                ? new Date(notebook.deletedAt)
                : null,
              deletionGroupId: notebook.deletionGroup ?? null,
              isDeletionRoot: notebook.isDeletionRoot ?? false,
            }
          : {}),
      },
    });
    if (notebook.coverAttachmentKey) notebookCovers.set(id, notebook.coverAttachmentKey);
  }
  for (const notebook of data.notebooks) {
    const pending = [...notebook.sections];
    let guard = 0;
    while (pending.length) {
      if (++guard > notebook.sections.length + 1)
        throw new ApiError(400, "Некорректная иерархия разделов");
      const ready = pending.filter(
        (section) => !section.parentKey || sectionIds.has(section.parentKey),
      );
      if (!ready.length)
        throw new ApiError(400, "Некорректная иерархия разделов");
      for (const section of ready) {
        const id = randomUUID();
        sectionIds.set(section.key, id);
        await tx.section.create({
          data: {
            id,
            notebookId: notebookIds.get(notebook.key)!,
            parentId: section.parentKey
              ? sectionIds.get(section.parentKey)!
              : null,
            title: section.title,
            icon: section.icon,
            color: section.color ?? "default",
            sortOrder: section.sortOrder,
            createdAt: new Date(section.createdAt),
            updatedAt: new Date(section.updatedAt),
            ...(mode === "restore"
              ? {
                  deletedAt: section.deletedAt
                    ? new Date(section.deletedAt)
                    : null,
                  deletionGroupId: section.deletionGroup ?? null,
                  isDeletionRoot: section.isDeletionRoot ?? false,
                }
              : {}),
          },
        });
        pending.splice(pending.indexOf(section), 1);
      }
    }
    for (const section of notebook.sections)
      for (const page of section.pages) {
        const id = pageIds.get(page.key)!;
        const content = rewriteInternalPageReferences(
          rewriteAttachmentReferences(
            blockNoteContentSchema.parse(page.content),
            attachmentIds,
            "import",
          ),
          pageIds,
          "import",
        ) as Prisma.InputJsonValue;
        const createdPage = await tx.page.create({
          data: {
            id,
            sectionId: sectionIds.get(section.key)!,
            title: page.title,
            icon: page.icon ?? null,
            color: page.color ?? "default",
            backgroundType: page.backgroundType ?? "default",
            backgroundColor: page.backgroundColor ?? "default",
            backgroundGradient: page.backgroundGradient ?? null,
            backgroundPattern: page.backgroundPattern ?? "plain",
            backgroundPosition: page.backgroundPosition ?? "center",
            backgroundOverlay: page.backgroundOverlay ?? "medium",
            appearancePreset: page.appearancePreset ?? null,
            content,
            searchText: extractBlockNoteText(content),
            sortOrder: page.sortOrder,
            isFavorite: mode === "restore" ? page.isFavorite : false,
            revision: 0,
            createdAt: new Date(page.createdAt),
            updatedAt: new Date(page.updatedAt),
            ...(mode === "restore"
              ? {
                  deletedAt: page.deletedAt ? new Date(page.deletedAt) : null,
                  deletionGroupId: page.deletionGroup ?? null,
                  isDeletionRoot: page.isDeletionRoot ?? false,
                }
              : {}),
          },
        });
        await syncPageTags(tx, userId, id, `${createdPage.title} ${createdPage.searchText}`);
        for (const key of portableAttachmentKeysInContent(page.content))
          if (!attachmentPage.has(key)) attachmentPage.set(key, id);
        if (page.coverAttachmentKey) {
          attachmentPage.set(page.coverAttachmentKey, id);
          pageCovers.set(id, page.coverAttachmentKey);
        }
        if (page.backgroundAttachmentKey) {
          attachmentPage.set(page.backgroundAttachmentKey, id);
          pageBackgrounds.set(id, page.backgroundAttachmentKey);
        }
        if (mode === "restore")
          for (const version of page.versions ?? []) {
            const versionContent = rewriteInternalPageReferences(
              rewriteAttachmentReferences(
                blockNoteContentSchema.parse(version.content),
                attachmentIds,
                "import",
              ),
              pageIds,
              "import",
            ) as Prisma.InputJsonValue;
            await tx.pageVersion.create({
              data: {
                pageId: id,
                title: version.title,
                content: versionContent,
                searchText: extractBlockNoteText(versionContent),
                contentHash: pageContentHash(version.title, versionContent),
                reason: version.reason,
                createdAt: new Date(version.createdAt),
              },
            });
          }
      }
  }
  const importedPages = await tx.page.findMany({
    where: { id: { in: [...pageIds.values()] }, section: { notebook: { userId } } },
    select: { id: true, content: true },
  });
  for (const page of importedPages) {
    await syncPageLinks(tx, userId, page.id, page.content);
    await syncLiveWidgetIndex(tx, page.id, page.content);
  }
  for (const file of files)
    await tx.upload.create({
      data: {
        id: file.id,
        userId,
        pageId: attachmentPage.get(file.attachment.key),
        storageName: file.storageName,
        originalName: safeDownloadName(file.attachment.fileName),
        mimeType: file.attachment.mimeType,
        size: file.attachment.size,
        sha256: file.attachment.sha256,
      },
    });
  if (data.savedItems?.length) await importSavedItems(tx, userId, data.savedItems, attachmentIds, pageIds);
  for (const [noteIndex, note] of (data.quickNotes ?? []).entries()) {
    const createdNote = await tx.quickNote.create({
      data: {
        userId,
        title: note.title,
        body: note.body,
        color: note.color,
        icon: note.icon,
        isPinned: note.isPinned,
        sortOrder: note.sortOrder ?? noteIndex,
        status: note.status ?? (note.archivedAt ? "ARCHIVED" : "INBOX"),
        archivedAt: note.archivedAt ? new Date(note.archivedAt) : null,
        createdAt: new Date(note.createdAt),
        updatedAt: new Date(note.updatedAt),
      },
    });
    await syncQuickNoteTags(tx, userId, createdNote.id, `${createdNote.title} ${createdNote.body}`);
  }
  for (const [pageId, key] of pageCovers) {
    const uploadId = attachmentIds.get(key);
    if (uploadId)
      await tx.page.update({
        where: { id: pageId },
        data: { coverUploadId: uploadId },
      });
  }
  for (const [pageId, key] of pageBackgrounds) {
    const uploadId = attachmentIds.get(key);
    if (uploadId)
      await tx.page.update({
        where: { id: pageId },
        data: { backgroundUploadId: uploadId },
      });
  }
  for (const [notebookId, key] of notebookCovers) {
    const uploadId = attachmentIds.get(key);
    if (uploadId) await tx.notebook.update({ where: { id: notebookId }, data: { coverUploadId: uploadId, coverType: "image" } });
  }
  return { notebookIds, pageIds };
}

export async function commitImport(
  userId: string,
  prepared: PreparedImport,
  destinationSectionId?: string,
) {
  const portableData: ArchiveData = prepared.page
    ? { notebooks: [], attachments: prepared.page.attachments }
    : prepared.data!;
  return withPortableAttachments(userId, prepared, portableData.attachments, async (tx, materialized) => {
    if (prepared.page) {
      if (!destinationSectionId)
        throw new ApiError(400, "Не выбран раздел назначения");
      const section = await tx.section.findFirst({
        where: {
          id: destinationSectionId,
          deletedAt: null,
          notebook: { userId, deletedAt: null },
        },
        select: { id: true },
      });
      if (!section) throw new ApiError(404, "Раздел назначения не найден");
      const max = await tx.page.aggregate({
        where: { sectionId: section.id, deletedAt: null },
        _max: { sortOrder: true },
      });
      const id = randomUUID();
      const source = prepared.page.page;
      const content = rewriteAttachmentReferences(
        rewriteInternalPageReferences(blockNoteContentSchema.parse(source.content), new Map(), "import"),
        materialized.ids,
        "import",
      ) as Prisma.InputJsonValue;
      const created = await tx.page.create({
        data: {
          id,
          sectionId: section.id,
          title: source.title,
          icon: source.icon ?? null,
          color: source.color ?? "default",
          backgroundType: source.backgroundType ?? "default",
          backgroundColor: source.backgroundColor ?? "default",
          backgroundGradient: source.backgroundGradient ?? null,
          backgroundPattern: source.backgroundPattern ?? "plain",
          backgroundPosition: source.backgroundPosition ?? "center",
          backgroundOverlay: source.backgroundOverlay ?? "medium",
          appearancePreset: source.appearancePreset ?? null,
          content,
          searchText: extractBlockNoteText(content),
          sortOrder: (max._max.sortOrder ?? -1) + 1,
          revision: 0,
        },
      });
      await syncPageTags(tx, userId, id, `${created.title} ${created.searchText}`);
      await syncPageLinks(tx, userId, id, created.content);
      await syncLiveWidgetIndex(tx, id, created.content);
      for (const file of materialized.files)
        await tx.upload.create({
          data: {
            id: file.id,
            userId,
            pageId: id,
            storageName: file.storageName,
            originalName: safeDownloadName(file.attachment.fileName),
            mimeType: file.attachment.mimeType,
            size: file.attachment.size,
            sha256: file.attachment.sha256,
          },
        });
      const coverId = source.coverAttachmentKey
        ? materialized.ids.get(source.coverAttachmentKey)
        : null;
      const backgroundId = source.backgroundAttachmentKey
        ? materialized.ids.get(source.backgroundAttachmentKey)
        : null;
      if (coverId || backgroundId)
        await tx.page.update({
          where: { id },
          data: {
            coverUploadId: coverId,
            backgroundUploadId: backgroundId,
          },
        });
      return { pageId: id };
    }
    const result = await createPortableData(
      tx,
      userId,
      portableData,
      materialized.ids,
      materialized.files,
      "import",
    );
    return { notebookIds: [...result.notebookIds.values()] };
  });
}

export async function restoreBackupData(
  userId: string,
  prepared: PreparedImport,
) {
  if (!prepared.data || prepared.manifest?.format !== BACKUP_FORMAT)
    throw new ApiError(400, "Некорректная резервная копия");
  const { data, manifest } = prepared;
  const oldUploads = await withPortableAttachments(userId, prepared, data.attachments, async (tx, materialized) => {
    // Page deletion clears convertedPageId through its FK. Keep v1–v5 saved items and tags.
    if (manifest.version >= DATA_FORMAT_VERSION)
      await tx.savedItem.deleteMany({ where: { userId } });
    const removable = { userId, savedItems: { none: {} } };
    const removed = await tx.upload.findMany({ where: removable, select: { storageName: true } });
    await tx.notebook.deleteMany({ where: { userId } });
    await tx.upload.deleteMany({ where: removable });
    if (manifest.version >= 4)
      await tx.quickNote.deleteMany({ where: { userId } });
    const restored = await createPortableData(
      tx,
      userId,
      data,
      materialized.ids,
      materialized.files,
      "restore",
    );
    if (manifest.version >= 2) {
      await tx.pageTemplate.deleteMany({
        where: { userId, isBuiltIn: false },
      });
      for (const template of data.templates ?? [])
        await tx.pageTemplate.create({
          data: {
            userId,
            name: template.name,
            description: template.description,
            icon: template.icon,
            content: validateTemplateContent(
              restoreTemplateReferences(template.content, restored.pageIds, manifest.version).content,
            ) as Prisma.InputJsonValue,
            sortOrder: template.sortOrder,
          },
        });
    }
    return removed;
  });
  await Promise.all(
    oldUploads.map((upload) =>
      rm(resolveStoragePath(upload.storageName), { force: true }),
    ),
  );
  return { warnings: prepared.summary.warnings ?? [] };
}

export async function disposePreparedImport(prepared: PreparedImport) {
  await rm(prepared.directory, { recursive: true, force: true });
}
