import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { SavedItemOperation } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { resolveSavedItemTitle, savedItemTitleOriginsEnabled, websiteTitle } from "@/lib/saved-item-title";
import { captureCanonicalUrl, captureContentType, captureDetails } from "@/lib/saved-device-capture";
import { classifySavedLink } from "@/lib/saved-link";
import { extractHashtags } from "@/lib/hashtags";
import { deviceCaptureDetailsSchema, type DeviceCaptureInput, type DevicePreviewInput, type SavedItemCreateInput, type SavedItemListInput, type SavedItemUpdateInput } from "@/lib/saved-item-validation";
import { createPageInTransaction } from "./page-service";
import { enqueueNewSavedArticle } from "./saved-article-queue";
import { syncSavedItemTags } from "./tag-service";
import { lockUserUploads, type PreparedUpload, withUploadWrites } from "./upload-service";

const itemSelect = {
  id: true, title: true, titleOrigin: true, sharedTitle: true, text: true, url: true, reviewStatus: true,
  metadataTitle: true, metadataDescription: true, metadataSiteName: true, metadataImageUrl: true,
  androidMetadataFields: true, previewUploadId: true,
  deviceCapture: true, deviceCaptureUntil: true, deviceCaptureFailure: true,
  archivedAt: true, convertedAt: true, convertedPageId: true, createdAt: true, updatedAt: true,
  tags: { orderBy: { tag: { normalized: "asc" } }, select: { tag: { select: { name: true, normalized: true } } } },
  attachments: { orderBy: { position: "asc" }, select: { upload: { select: { id: true, originalName: true, mimeType: true, size: true } } } },
  metadataJob: { select: { finishedAt: true, failed: true, failureReason: true } },
  article: { select: { sourceUrl: true } },
} as const satisfies Prisma.SavedItemSelect;
type Item = Prisma.SavedItemGetPayload<{ select: typeof itemSelect }>;
const DEVICE_CAPTURE_WAIT_MS = 90_000;

function attachmentUrl(id: string) { return `/api/uploads/${id}`; }

function displayTitle(item: Item) {
  return resolveSavedItemTitle({ ...item, androidCapture: Boolean(item.deviceCapture || item.deviceCaptureUntil),
    metadataTitleSource: captureDetails(item.deviceCapture)?.provenance?.title,
    fileName: item.attachments[0]?.upload.originalName });
}

function serializeItem(record: Item) {
  const {
    attachments, tags, metadataJob, metadataTitle, metadataDescription, metadataSiteName, metadataImageUrl,
    androidMetadataFields, previewUploadId, deviceCapture, deviceCaptureUntil, deviceCaptureFailure, article, ...item
  } = record;
  const sourceTitle = websiteTitle(metadataTitle) || null;
  const hasPreview = Boolean(previewUploadId || metadataImageUrl);
  const hasMetadata = Boolean(sourceTitle || metadataDescription || hasPreview);
  const hasDevicePreview = Boolean(previewUploadId || androidMetadataFields.length);
  const deviceReady = hasDevicePreview && Boolean(hasMetadata || metadataSiteName);
  const waitingForDevice = Boolean(deviceCaptureUntil && deviceCaptureUntil.getTime() > Date.now());
  const capture = captureDetails(deviceCapture);
  return {
    ...item,
    linkKind: item.url ? captureContentType(item.url, capture ?? {}) : null,
    supportsDevicePreview: item.url !== null,
    supportsDeviceCapture: item.url !== null,
    capture: capture ?? null,
    deviceCaptureStatus: waitingForDevice ? "pending" : deviceCaptureUntil ? "expired"
      : deviceCaptureFailure ? "partial" : capture ? "received" : null,
    deviceCaptureFailure,
    hasSavedArticle: article !== null && article.sourceUrl === item.url,
    displayTitle: displayTitle(record),
    canUseWebsiteTitle: savedItemTitleOriginsEnabled() && Boolean(sourceTitle)
      && item.titleOrigin !== "system",
    tags: tags.map(({ tag }) => tag),
    attachments: attachments.map(({ upload }) => ({ ...upload, url: attachmentUrl(upload.id) })),
    metadata: { title: sourceTitle, description: metadataDescription, siteName: metadataSiteName, hasPreview,
      androidFields: androidMetadataFields, coverOnDevice: Boolean(previewUploadId) },
    metadataStatus: waitingForDevice || (capture && metadataJob && !metadataJob.finishedAt) ? "queued"
      : deviceReady ? "ready" : !metadataJob ? "skipped" : !metadataJob.finishedAt ? "queued"
      : metadataJob.failed ? "failed" : hasMetadata ? "ready" : "empty",
    metadataFailure: !deviceReady && metadataJob?.failed ? metadataJob.failureReason : null,
  };
}

async function findOwnedItem(tx: Prisma.TransactionClient, userId: string, id: string) {
  return tx.savedItem.findFirst({ where: { id, userId }, select: itemSelect });
}

function fingerprint(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function previousResult(tx: Prisma.TransactionClient, userId: string, operation: SavedItemOperation, key: string, hash: string) {
  const request = await tx.savedItemRequest.findUnique({ where: { userId_operation_key: { userId, operation, key } } });
  if (request && request.fingerprint !== hash) throw new ApiError(409, "Ключ запроса уже использован с другим содержимым");
  return request?.resultId;
}

export async function listSavedItems(userId: string, input: SavedItemListInput) {
  const { archive, reviewStatus, tag, q, limit } = input;
  const cursor = input.cursor ? await db.savedItem.findFirst({
    where: { id: input.cursor, userId }, select: { id: true, createdAt: true },
  }) : null;
  if (input.cursor && !cursor) throw new ApiError(404, "Курсор не найден");

  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT s.id FROM "SavedItem" s WHERE s."userId" = ${userId}
    ${archive === "active" ? Prisma.sql`AND s."archivedAt" IS NULL` : Prisma.empty}
    ${archive === "archived" ? Prisma.sql`AND s."archivedAt" IS NOT NULL` : Prisma.empty}
    ${reviewStatus ? Prisma.sql`AND s."reviewStatus" = ${reviewStatus}::"SavedItemReviewStatus"` : Prisma.empty}
    ${tag ? Prisma.sql`AND EXISTS (
      SELECT 1 FROM "SavedItemTag" st JOIN "Tag" t ON t.id = st."tagId"
      WHERE st."savedItemId" = s.id AND t."userId" = ${userId} AND t.normalized = ${tag}
    )` : Prisma.empty}
    ${q ? Prisma.sql`AND s."searchVector" @@ websearch_to_tsquery('simple', ${q})` : Prisma.empty}
    ${cursor ? Prisma.sql`AND (s."createdAt", s.id) < (${cursor.createdAt.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${cursor.id})` : Prisma.empty}
    ORDER BY s."createdAt" DESC, s.id DESC LIMIT ${limit + 1}`);
  const ids = rows.slice(0, limit).map(row => row.id);
  const items = await db.savedItem.findMany({ where: { userId, id: { in: ids } }, select: itemSelect });
  const byId = new Map(items.map(item => [item.id, serializeItem(item)]));
  return {
    items: ids.flatMap(id => byId.get(id) ?? []),
    nextCursor: rows.length > limit ? ids[ids.length - 1] : null,
  };
}

export async function getSavedItem(userId: string, id: string) {
  const item = await findOwnedItem(db, userId, id);
  if (!item) throw new ApiError(404, "Материал не найден");
  return serializeItem(item);
}

export async function applySavedDevicePreview(userId: string, id: string, key: string, input: DevicePreviewInput, cover: PreparedUpload | null) {
  return saveDevicePreview(userId, id, key, input, cover);
}

export async function applySavedDeviceCapture(userId: string, id: string, key: string, input: DeviceCaptureInput, cover: PreparedUpload | null) {
  return saveDevicePreview(userId, id, key, input, cover, input);
}

async function saveDevicePreview(
  userId: string, id: string, key: string, input: DevicePreviewInput, cover: PreparedUpload | null, capture?: DeviceCaptureInput,
) {
  const title = websiteTitle(input.title ?? null);
  if (input.title && !title) throw new ApiError(422, "Источник вернул служебную страницу");
  if (!capture && !title && !input.description && !input.siteName && !cover) throw new ApiError(400, "Превью пустое");
  const hash = fingerprint(capture ? [id, capture, cover?.sha256] : [id, title, input.description, input.siteName, cover?.sha256]);
  await withUploadWrites(userId, async (tx, store) => {
    const item = await findOwnedItem(tx, userId, id);
    if (!item) throw new ApiError(404, "Материал не найден");
    if (!item.url) throw new ApiError(409, "У материала нет ссылки");
    const operation = capture ? "deviceCapture" : "devicePreview";
    if (await previousResult(tx, userId, operation, key, hash)) return;
    if (capture) {
      const receipt = await tx.savedItemRequest.findUnique({
        where: { userId_operation_key: { userId, operation: "create", key } }, select: { resultId: true },
      });
      if (receipt?.resultId !== id) throw new ApiError(409, "Ключ захвата не соответствует сохранённой ссылке");
    }
    const fields = new Set(item.androidMetadataFields);
    const updates: Prisma.SavedItemUpdateInput = {};
    const titleSource = capture?.provenance?.title;
    if (title && (!capture || titleSource) && !websiteTitle(item.metadataTitle)) {
      updates.metadataTitle = title;
      if (titleSource !== "intent" && titleSource !== "html") fields.add("title");
    }
    if (input.description && !item.metadataDescription) {
      updates.metadataDescription = input.description;
      fields.add("description");
    }
    if (input.siteName && (!item.metadataSiteName || item.metadataSiteName === URL.parse(item.url)?.hostname)) {
      updates.metadataSiteName = input.siteName;
      fields.add("siteName");
    }
    if (cover && item.previewUploadId === null) updates.previewUpload = { connect: { id: (await store(cover)).id } };
    if (capture) {
      const kind = captureContentType(item.url, capture);
      const link = classifySavedLink(item.url);
      const canonicalUrl = captureCanonicalUrl(item.url, capture.canonicalUrl);
      const videoId = link.kind === "video" && link.provider === "youtube" ? link.videoId ?? undefined : undefined;
      const hasCover = Boolean(cover || item.previewUploadId);
      const reliableTitle = Boolean(title && capture.provenance?.title && capture.provenance.title !== "intent");
      const complete = reliableTitle && (hasCover || capture.media === "none") && !capture.failure;
      const fieldsAccepted = {
        title: updates.metadataTitle, description: updates.metadataDescription, siteName: updates.metadataSiteName,
        cover: updates.previewUpload, canonicalUrl, contentType: kind, author: capture.author,
        publishedAt: capture.publishedAt, videoId,
      };
      const provenance = Object.fromEntries(Object.entries(capture.provenance ?? {})
        .filter(([field]) => fieldsAccepted[field as keyof typeof fieldsAccepted]));
      const details = deviceCaptureDetailsSchema.parse({
        canonicalUrl, contentType: kind, author: capture.author, publishedAt: capture.publishedAt, videoId, provenance,
      });
      // Prisma JSON omits optional properties when they are absent.
      updates.deviceCapture = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
      updates.deviceCaptureUntil = null;
      updates.deviceCaptureFailure = capture.failure ?? (!hasCover && capture.media === "unavailable" ? "media" : null);

      const now = new Date();
      const waiting = { savedItemId: id, finishedAt: null, attempts: 0, leaseToken: null };
      await tx.savedItemMetadataJob.updateMany({
        where: complete ? { savedItemId: id, finishedAt: null } : waiting,
        data: complete ? { finishedAt: now, leaseToken: null, failed: false, failureReason: null } : { availableAt: now },
      });
      const articleComplete = item.article?.sourceUrl === item.url;
      await tx.savedArticleJob.updateMany({
        where: { savedItemId: id, status: kind !== "article" || articleComplete ? { in: ["queued", "retry", "running"] } : "queued" },
        data: kind !== "article" || articleComplete
          ? { status: articleComplete ? "ready" : "fallback", reason: articleComplete ? null : "card",
              finishedAt: now, leaseToken: null, leaseUntil: null }
          : { availableAt: now },
      });
    }
    if (Object.keys(updates).length) {
      updates.androidMetadataFields = [...fields];
      await tx.savedItem.update({ where: { id }, data: updates });
    }
    await tx.savedItemRequest.create({ data: { userId, operation, key, fingerprint: hash, resultId: id } });
  });
}

export async function retrySavedItemMetadata(userId: string, id: string) {
  const item = await db.savedItem.findFirst({ where: { id, userId }, select: { url: true } });
  if (!item) throw new ApiError(404, "Материал не найден");
  if (!item.url) throw new ApiError(409, "У материала нет ссылки");
  const changed = await db.savedItemMetadataJob.updateMany({
    where: { savedItemId: id, savedItem: { userId, OR: [{ deviceCaptureUntil: null }, { deviceCaptureUntil: { lte: new Date() } }] },
      finishedAt: { lte: new Date(Date.now() - 30_000) } },
    data: { availableAt: new Date(), finishedAt: null, failed: false, failureReason: null, leaseToken: null, attempts: 0 },
  });
  if (!changed.count) throw new ApiError(409, "Проверка уже в очереди или завершилась менее 30 секунд назад");
  return getSavedItem(userId, id);
}

export async function createSavedItem(userId: string, key: string, input: SavedItemCreateInput, files: PreparedUpload[], androidFirst = false) {
  const { title, sharedTitle, text, url, tags } = input;
  if (!title && !sharedTitle && !text.trim() && !url && !files.length) throw new ApiError(400, "Материал пуст");
  const payload = [title, text, url, tags, files.map(({ originalName, mimeType, size, sha256 }) => [originalName, mimeType, size, sha256])];
  const hash = fingerprint(sharedTitle === undefined ? payload : [...payload, { sharedTitle }]);
  return withUploadWrites(userId, async (tx, store) => {
    const previousId = await previousResult(tx, userId, "create", key, hash);
    if (previousId) {
      const previous = await findOwnedItem(tx, userId, previousId);
      if (!previous) throw new ApiError(410, "Материал уже удалён");
      return { item: serializeItem(previous), replayed: true };
    }

    const deviceCaptureUntil = androidFirst && url ? new Date(Date.now() + DEVICE_CAPTURE_WAIT_MS) : null;
    const { id } = await tx.savedItem.create({
      data: {
        userId, title, sharedTitle, text, url,
        titleOrigin: title ? "manual" : sharedTitle ? "share" : "system",
        deviceCaptureUntil,
        ...(url ? { metadataJob: { create: deviceCaptureUntil ? { availableAt: deviceCaptureUntil } : {} } } : {}),
      },
      select: { id: true },
    });
    await syncSavedItemTags(tx, userId, id, tags);
    for (const [position, file] of files.entries()) {
      const upload = await store(file);
      await tx.savedItemAttachment.create({ data: { savedItemId: id, uploadId: upload.id, position } });
    }
    await tx.savedItemRequest.create({ data: { userId, operation: "create", key, fingerprint: hash, resultId: id } });
    await enqueueNewSavedArticle(tx, id, url, files.length > 0, deviceCaptureUntil ?? undefined);
    const item = await tx.savedItem.findUniqueOrThrow({ where: { id }, select: itemSelect });
    return { item: serializeItem(item), replayed: false };
  });
}

export async function updateSavedItem(userId: string, id: string, { archived, tags, title, useWebsiteTitle, ...fields }: SavedItemUpdateInput) {
  return db.$transaction(async tx => {
    await lockUserUploads(tx, userId);
    const rows = await tx.$queryRaw<{ archivedAt: Date | null; metadataTitle: string | null }[]>(Prisma.sql`
      SELECT "archivedAt", "metadataTitle" FROM "SavedItem" WHERE id = ${id} AND "userId" = ${userId} FOR NO KEY UPDATE`);
    const row = rows[0];
    if (!row) throw new ApiError(404, "Материал не найден");
    if (useWebsiteTitle && (!savedItemTitleOriginsEnabled() || !websiteTitle(row.metadataTitle))) {
      throw new ApiError(409, "Заголовок сайта недоступен");
    }
    await tx.savedItem.update({
      where: { id },
      data: {
        ...fields,
        ...(useWebsiteTitle || title !== undefined ? { title: title ?? "", titleOrigin: title ? "manual" : "system" } : {}),
        updatedAt: new Date(), archivedAt: archived === undefined ? undefined : archived ? row.archivedAt ?? new Date() : null,
      },
    });
    if (tags) await syncSavedItemTags(tx, userId, id, tags);
    return serializeItem(await tx.savedItem.findUniqueOrThrow({ where: { id }, select: itemSelect }));
  });
}

export async function deleteSavedItem(userId: string, id: string) {
  await db.$transaction(async tx => {
    await lockUserUploads(tx, userId);
    if (!(await tx.savedItem.deleteMany({ where: { id, userId } })).count) {
      throw new ApiError(404, "Материал не найден");
    }
  });
}

function conversionContent(item: Item): Prisma.InputJsonArray {
  const textNode = (text: string) => ({ type: "text", text, styles: {} });
  const content: Prisma.InputJsonValue[] = item.text
    ? [{ type: "paragraph", content: [textNode(item.text.replace(/\r\n?/gu, "\n"))] }]
    : [];
  if (item.url) {
    content.push({ type: "paragraph", content: [{ type: "link", href: new URL(item.url).href, content: [textNode(item.url)] }] });
  }
  for (const { upload } of item.attachments) {
    content.push({
      type: upload.mimeType === "application/pdf" ? "file" : "image",
      props: { url: attachmentUrl(upload.id), name: upload.originalName },
    });
  }
  const existingTags = new Set(extractHashtags(`${displayTitle(item)} ${item.text} ${item.url ?? ""}`).map(tag => tag.normalized));
  const tagText = item.tags.filter(({ tag }) => !existingTags.has(tag.normalized)).map(({ tag }) => `#${tag.normalized}`).join(" ");
  if (tagText) content.push({ type: "paragraph", content: [textNode(tagText)] });
  return content.length ? content : [{ type: "paragraph", content: [] }];
}

export async function convertSavedItem(userId: string, id: string, sectionId: string, key: string) {
  const hash = fingerprint([id, sectionId]);
  return db.$transaction(async tx => {
    await lockUserUploads(tx, userId);
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "SavedItem" WHERE id = ${id} AND "userId" = ${userId} FOR NO KEY UPDATE`);
    if (!rows.length) throw new ApiError(404, "Материал не найден");
    const previousId = await previousResult(tx, userId, "convert", key, hash);
    const item = await tx.savedItem.findUniqueOrThrow({ where: { id }, select: itemSelect });
    const pageId = previousId ?? item.convertedPageId;
    if (pageId) {
      const page = await tx.page.findFirst({
        where: { id: pageId, deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } },
        select: { sectionId: true },
      });
      if (!page) throw new ApiError(410, "Созданная страница недоступна");
      if (!previousId) {
        if (page.sectionId !== sectionId) throw new ApiError(409, "Материал уже перенесён в другой раздел");
        await tx.savedItemRequest.create({ data: { userId, operation: "convert", key, fingerprint: hash, resultId: pageId } });
      }
      return { pageId, replayed: true };
    }
    if (item.convertedAt) throw new ApiError(410, "Созданная страница недоступна");

    const page = await createPageInTransaction(tx, userId, {
      sectionId, title: displayTitle(item), content: conversionContent(item),
    });
    await tx.upload.updateMany({
      where: { userId, id: { in: item.attachments.map(({ upload }) => upload.id) } },
      data: { pageId: page.id },
    });
    const now = new Date();
    await tx.savedItem.update({ where: { id }, data: { archivedAt: item.archivedAt ?? now, convertedAt: now, convertedPageId: page.id } });
    await tx.savedItemRequest.create({ data: { userId, operation: "convert", key, fingerprint: hash, resultId: page.id } });
    return { pageId: page.id, replayed: false };
  }, { timeout: 30_000 });
}
