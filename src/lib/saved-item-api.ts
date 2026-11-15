import { NextResponse, type NextRequest } from "next/server";
import { ApiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import {
  MAX_DEVICE_PREVIEW_BYTES, MAX_SAVED_ATTACHMENTS, MAX_SAVED_JSON_BYTES,
  MAX_SAVED_MULTIPART_BYTES, savedItemCreateSchema, savedItemIdSchema, savedItemIdempotencyKeySchema,
} from "@/lib/saved-item-validation";
import { prepareUpload, type PreparedUpload } from "@/lib/services/upload-service";
import { prepareDevicePreviewImage } from "@/lib/services/saved-device-preview-image";
import { getSavedItem } from "@/lib/services/saved-item-service";
import { maxUploadBytes } from "@/lib/uploads";

export function requireSavedItemMutation(request: NextRequest) {
  if (!request.headers.get("origin")) throw new ApiError(403, "Требуется Origin запроса");
  validateRequestOrigin(request);
  return requireUser();
}

export function readIdempotencyKey(request: Request) {
  return savedItemIdempotencyKeySchema.parse(request.headers.get("idempotency-key"));
}

async function boundedBody(request: Request, maxBytes: number, timeoutMs?: number) {
  const length = request.headers.get("content-length");
  if (length && Number(length) > maxBytes) throw new ApiError(413, "Запрос слишком большой");
  if (!request.body) throw new ApiError(400, "Тело запроса отсутствует");
  const reader = request.body.getReader();
  const deadline = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  deadline?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (deadline?.aborted) throw new ApiError(408, "Истекло время загрузки");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new ApiError(413, "Запрос слишком большой");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (deadline?.aborted) throw new ApiError(408, "Истекло время загрузки");
    throw new ApiError(400, "Не удалось прочитать тело запроса");
  } finally {
    deadline?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  return new Request(request.url, {
    method: request.method, headers: { "content-type": request.headers.get("content-type") ?? "" },
    body: Buffer.concat(chunks, bytes),
  });
}

function mediaType(request: Request) {
  return request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
}

export async function readSavedItemJson(request: Request) {
  if (mediaType(request) !== "application/json") throw new ApiError(415, "Требуется application/json");
  return readJson(await boundedBody(request, MAX_SAVED_JSON_BYTES));
}

export async function readSavedItemCreate(request: Request) {
  if (mediaType(request) !== "multipart/form-data") {
    return { input: savedItemCreateSchema.parse(await readSavedItemJson(request)), files: [] };
  }
  const maxBytes = Math.min(MAX_SAVED_MULTIPART_BYTES, MAX_SAVED_ATTACHMENTS * maxUploadBytes() + MAX_SAVED_JSON_BYTES);
  const body = await boundedBody(request, maxBytes);
  const form = await body.formData().catch(() => { throw new ApiError(400, "Некорректный multipart"); });
  const payloads = form.getAll("payload");
  const payload = payloads[0];
  if (payloads.length > 1 || (payload !== undefined && typeof payload !== "string")
    || [...form.keys()].some(key => key !== "payload" && key !== "file")) {
    throw new ApiError(400, "Ожидаются JSON в поле payload и файлы в полях file");
  }
  if (payload && Buffer.byteLength(payload) > MAX_SAVED_JSON_BYTES) throw new ApiError(413, "Поле payload слишком большое");
  const json = payload === undefined ? {} : await readJson(new Request(request.url, { method: "POST", body: payload }));
  const input = savedItemCreateSchema.parse(json);
  const files = form.getAll("file");
  if (files.length > MAX_SAVED_ATTACHMENTS) throw new ApiError(413, "Слишком много файлов");
  const prepared = await Promise.all(files.map(file => {
    if (!(file instanceof File)) throw new ApiError(400, "Ожидается файл");
    return prepareUpload(file, true);
  }));
  return { input, files: prepared };
}

export async function readDevicePreview<Input>(request: Request, schema: { parse(value: unknown): Input }) {
  const maxJsonBytes = 16 * 1024;
  const type = mediaType(request);
  if (type === "application/json") {
    const body = await boundedBody(request, maxJsonBytes, 15_000);
    return { input: schema.parse(await readJson(body)), cover: null };
  }
  if (type !== "multipart/form-data") throw new ApiError(415, "Требуется JSON или multipart");
  const body = await boundedBody(request, Math.min(maxUploadBytes(), MAX_DEVICE_PREVIEW_BYTES) + maxJsonBytes, 15_000);
  const form = await body.formData().catch(() => { throw new ApiError(400, "Некорректный multipart"); });
  const [payload] = form.getAll("payload");
  const [cover] = form.getAll("cover");
  if ([...form].length !== 2 || typeof payload !== "string" || Buffer.byteLength(payload) > maxJsonBytes || !(cover instanceof File)) {
    throw new ApiError(400, "Ожидаются поля payload и cover");
  }
  const input = schema.parse(await readJson(new Request(request.url, { method: "POST", body: payload })));
  return { input, cover };
}

const state = globalThis as typeof globalThis & { notebookDeviceCoverWrites?: number };

export async function receiveDevicePreview<Input>(
  request: NextRequest,
  params: Promise<{ id: string }>,
  schema: { parse(value: unknown): Input },
  apply: (userId: string, id: string, key: string, input: Input, cover: PreparedUpload | null) => Promise<void>,
) {
  const [user, param] = await Promise.all([requireSavedItemMutation(request), params]);
  const id = savedItemIdSchema.parse(param.id);
  const key = readIdempotencyKey(request);
  if (!(await getSavedItem(user.id, id)).url) throw new ApiError(409, "У материала нет ссылки");
  if ((state.notebookDeviceCoverWrites ?? 0) >= 3) {
    return NextResponse.json({ error: "Сервер занят обработкой обложек" }, { status: 429, headers: { "retry-after": "5" } });
  }
  state.notebookDeviceCoverWrites = (state.notebookDeviceCoverWrites ?? 0) + 1;
  try {
    const { input, cover } = await readDevicePreview(request, schema);
    await apply(user.id, id, key, input, cover && await prepareDevicePreviewImage(cover));
  } finally {
    state.notebookDeviceCoverWrites--;
  }
  return new NextResponse(null, { status: 204, headers: { "cache-control": "private, no-store" } });
}
