import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
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
  manifestSchema,
  pageExportSchema,
  type ArchiveData,
  type DataManifest,
  type PageExport,
  type PortableAttachment,
} from "@/lib/data-format";
import {
  createDataTempDirectory,
  detectImportKind,
  extractZipSafely,
  readJsonFile,
  writeRequestToFile,
} from "@/lib/archive";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { extractBlockNoteText } from "@/lib/blocknote-text";
import { IMAGE_EXTENSIONS, isValidImageMime } from "@/lib/uploads";
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
import { validateTemplateContent } from "@/lib/page-templates";

export type ImportSummary = {
  kind: "page" | "notebook" | "all" | "backup";
  title: string;
  notebooks: number;
  sections: number;
  pages: number;
  attachments: number;
  totalBytes: number;
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
function assertPortableReferences(data: ArchiveData) {
  const available = new Set(
    data.attachments.map((attachment) => attachment.key),
  );
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
}

async function validateArchiveFiles(directory: string, data: ArchiveData) {
  const allowed = new Set(["manifest.json", "notebook.json", "backup.json"]);
  let total = 0;
  for (const attachment of data.attachments) {
    if (!attachment.archivePath)
      throw new ApiError(400, "Вложение не содержит archivePath");
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
    const bytes = new Uint8Array(await readFile(filePath));
    if (
      !IMAGE_EXTENSIONS[attachment.mimeType] ||
      !isValidImageMime(attachment.mimeType, bytes)
    )
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
    attachments: data.attachments.length,
    totalBytes: bytes,
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
        if (
          !IMAGE_EXTENSIONS[attachment.mimeType] ||
          !isValidImageMime(attachment.mimeType, bytes)
        )
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
    assertPortableReferences(data);
    const bytes = await validateArchiveFiles(extracted, data);
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
) {
  const ids = new Map<string, string>();
  const files: {
    id: string;
    storageName: string;
    filePath: string;
    attachment: PortableAttachment;
  }[] = [];
  try {
    for (const attachment of attachments) {
      const extension = IMAGE_EXTENSIONS[attachment.mimeType];
      if (!extension) throw new ApiError(415, "Неподдерживаемое вложение");
      const id = randomUUID();
      const storageName = `${userId}/${randomUUID()}.${extension}`;
      const target = resolveStoragePath(storageName);
      await mkdir(path.dirname(target), { recursive: true });
      if (attachment.dataBase64)
        await writeFile(target, Buffer.from(attachment.dataBase64, "base64"), {
          flag: "wx",
        });
      else if (attachment.archivePath)
        await copyFile(
          path.join(
            prepared.directory,
            "extracted",
            ...attachment.archivePath.split("/"),
          ),
          target,
          (await import("node:fs")).constants.COPYFILE_EXCL,
        );
      else throw new ApiError(400, "Данные вложения отсутствуют");
      ids.set(attachment.key, id);
      files.push({ id, storageName, filePath: target, attachment });
    }
    return { ids, files };
  } catch (error) {
    await Promise.all(files.map((file) => rm(file.filePath, { force: true })));
    throw error;
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
        await tx.page.create({
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
  const materialized = await materializeAttachments(
    userId,
    prepared,
    portableData.attachments,
  );
  try {
    if (prepared.page) {
      if (!destinationSectionId)
        throw new ApiError(400, "Не выбран раздел назначения");
      const section = await db.section.findFirst({
        where: {
          id: destinationSectionId,
          deletedAt: null,
          notebook: { userId, deletedAt: null },
        },
        select: { id: true },
      });
      if (!section) throw new ApiError(404, "Раздел назначения не найден");
      const page = await db.$transaction(async (tx) => {
        const max = await tx.page.aggregate({
          where: { sectionId: section.id, deletedAt: null },
          _max: { sortOrder: true },
        });
        const id = randomUUID();
        const source = prepared.page!.page;
        const content = rewriteAttachmentReferences(
          blockNoteContentSchema.parse(source.content),
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
        return coverId || backgroundId
          ? tx.page.update({
              where: { id },
              data: {
                coverUploadId: coverId,
                backgroundUploadId: backgroundId,
              },
            })
          : created;
      });
      return { pageId: page.id };
    }
    const result = await db.$transaction(
      (tx) =>
        createPortableData(
          tx,
          userId,
          portableData,
          materialized.ids,
          materialized.files,
          "import",
        ),
      { timeout: 120_000 },
    );
    return { notebookIds: [...result.notebookIds.values()] };
  } catch (error) {
    await Promise.all(
      materialized.files.map((file) => rm(file.filePath, { force: true })),
    );
    throw error;
  }
}

export async function restoreBackupData(
  userId: string,
  prepared: PreparedImport,
) {
  if (!prepared.data || prepared.manifest?.format !== BACKUP_FORMAT)
    throw new ApiError(400, "Некорректная резервная копия");
  const oldUploads = await db.upload.findMany({
    where: { userId },
    select: { storageName: true },
  });
  const materialized = await materializeAttachments(
    userId,
    prepared,
    prepared.data.attachments,
  );
  try {
    await db.$transaction(
      async (tx) => {
        await tx.notebook.deleteMany({ where: { userId } });
        await tx.upload.deleteMany({ where: { userId } });
        await createPortableData(
          tx,
          userId,
          prepared.data!,
          materialized.ids,
          materialized.files,
          "restore",
        );
        if (prepared.manifest!.version >= 2) {
          await tx.pageTemplate.deleteMany({
            where: { userId, isBuiltIn: false },
          });
          for (const template of prepared.data!.templates ?? [])
            await tx.pageTemplate.create({
              data: {
                userId,
                name: template.name,
                description: template.description,
                icon: template.icon,
                content: validateTemplateContent(
                  template.content,
                ) as Prisma.InputJsonValue,
                sortOrder: template.sortOrder,
              },
            });
        }
      },
      { timeout: 120_000 },
    );
  } catch (error) {
    await Promise.all(
      materialized.files.map((file) => rm(file.filePath, { force: true })),
    );
    throw error;
  }
  await Promise.all(
    oldUploads.map((upload) =>
      rm(resolveStoragePath(upload.storageName), { force: true }),
    ),
  );
}

export async function disposePreparedImport(prepared: PreparedImport) {
  await rm(prepared.directory, { recursive: true, force: true });
}
