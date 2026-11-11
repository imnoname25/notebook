import type { NextRequest } from "next/server";
import { ApiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { MAX_SAVED_ATTACHMENTS, MAX_SAVED_JSON_BYTES, MAX_SAVED_MULTIPART_BYTES, savedItemCreateSchema, savedItemIdempotencyKeySchema } from "@/lib/saved-item-validation";
import { prepareUpload } from "@/lib/services/upload-service";
import { maxUploadBytes } from "@/lib/uploads";

export function requireSavedItemMutation(request: NextRequest) {
  if (!request.headers.get("origin")) throw new ApiError(403, "Требуется Origin запроса");
  validateRequestOrigin(request);
  return requireUser();
}

export function readIdempotencyKey(request: Request) {
  return savedItemIdempotencyKeySchema.parse(request.headers.get("idempotency-key"));
}

async function boundedBody(request: Request, maxBytes: number) {
  const length = request.headers.get("content-length");
  if (length && Number(length) > maxBytes) throw new ApiError(413, "Запрос слишком большой");
  if (!request.body) throw new ApiError(400, "Тело запроса отсутствует");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
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
    throw new ApiError(400, "Не удалось прочитать тело запроса");
  } finally {
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
