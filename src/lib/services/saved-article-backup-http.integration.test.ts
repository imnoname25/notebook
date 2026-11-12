import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveStoragePath } from "@/lib/storage";

const origin = process.env.TEST_SAVED_HTTP_ORIGIN;
const enabled = Boolean(origin && process.env.TEST_DATABASE_URL) && process.env.TEST_RESET_DATABASE === "1";
if (enabled) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("v7 backup and offline article HTTP routes", () => {
  let db: typeof import("@/lib/db").db;
  let userId: string;
  let cookie: string;
  let itemId: string;
  let raster: Buffer;
  let storageName: string;
  const backupIds: string[] = [];
  const key = "c".repeat(64);
  const request = (route: string, options?: RequestInit) => fetch(new URL(route, origin), {
    ...options, signal: AbortSignal.timeout(60_000),
  });
  const upload = (bytes: Uint8Array<ArrayBuffer>, confirmed = false) => ({
    method: "POST", body: bytes,
    headers: { cookie, origin: origin!, "content-type": "application/zip", ...(confirmed ? { "x-notebook-confirmation": "RESTORE" } : {}) },
  });

  beforeAll(async () => {
    ({ db } = await import("@/lib/db"));
    const { hashSessionToken, SESSION_COOKIE } = await import("@/lib/auth/session");
    const user = await db.user.create({ data: { email: `${randomUUID()}@backup-http.test`, name: "Backup HTTP", passwordHash: "unused", role: "ADMIN" } });
    userId = user.id;
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 3_600_000);
    await db.session.create({ data: { userId, tokenHash: hashSessionToken(token), expiresAt, absoluteExpiresAt: expiresAt } });
    cookie = `${SESSION_COOKIE}=${token}`;
    raster = await sharp({ create: { width: 40, height: 40, channels: 3, background: "teal" } }).webp().toBuffer();
    storageName = `${userId}/${randomUUID()}.webp`;
    await mkdir(path.dirname(resolveStoragePath(storageName)), { recursive: true });
    await writeFile(resolveStoragePath(storageName), raster);
    const image = await db.upload.create({ data: { userId, storageName, originalName: "offline.webp", mimeType: "image/webp",
      size: raster.length, sha256: createHash("sha256").update(raster).digest("hex") } });
    const sourceUrl = "https://offline.example/http-copy";
    const item = await db.savedItem.create({ data: { userId, url: sourceUrl, title: "Offline HTTP", titleOrigin: "manual",
      article: { create: { sourceUrl, contentVersion: 2, extractedAt: new Date(),
        blocks: [{ type: "paragraph", content: [{ type: "text", text: "Stored article via HTTP" }] }, { type: "image", key, alt: "Local" }],
        images: { create: { imageKey: key, sourceUrl: "https://offline.example/image.webp", position: 0, uploadId: image.id } },
      } },
    } });
    itemId = item.id;
  });
  afterAll(async () => {
    if (db && userId) {
      const backups = await import("./backup-service");
      for (const id of backupIds) await backups.deleteBackup(id);
      await db.user.delete({ where: { id: userId } });
      await rm(path.dirname(resolveStoragePath(storageName)), { recursive: true, force: true });
    }
    await db?.$disconnect();
  });

  it("requires authentication and rejects cross-origin import", async () => {
    expect((await request("/api/data/export/all")).status).toBe(401);
    expect((await request("/api/data/import", { method: "POST", headers: { cookie, origin: "https://foreign.invalid" }, body: "bad" })).status).toBe(403);
  });

  it("exports/imports through HTTP and reads remapped local images without extraction jobs", async () => {
    const response = await request("/api/data/export/all", { headers: { cookie } });
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect((await request("/api/data/import/preview", upload(bytes))).status).toBe(200);
    expect((await request("/api/data/import", upload(bytes))).status).toBe(201);
    const copy = await db.savedItem.findFirstOrThrow({ where: { userId, id: { not: itemId } } });
    const read = await request(`/api/saved-items/${copy.id}/article`, { headers: { cookie } });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ article: { contentVersion: 2, blocks: [{ type: "paragraph" }, { type: "image", key }] } });
    const image = await request(`/api/saved-items/${copy.id}/article/images/${key}`, { headers: { cookie } });
    expect(image.status).toBe(200);
    expect(Buffer.from(await image.arrayBuffer())).toEqual(raster);
    expect((await request(`/api/saved-items/${copy.id}/article/images/${key}`)).status).toBe(401);
    expect(await db.savedArticleJob.count({ where: { savedItem: { userId } } })).toBe(0);
    expect(await db.savedItemMetadataJob.count({ where: { savedItem: { userId }, finishedAt: null } })).toBe(0);
  });

  it("rejects a corrupt restore before making a safety backup or changing user data", async () => {
    const before = await db.backupRecord.count();
    const rows = await db.savedItem.count({ where: { userId } });
    const response = await request("/api/data/restore", upload(new TextEncoder().encode("PK-invalid"), true));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await db.backupRecord.count()).toBe(before);
    expect(await db.savedItem.count({ where: { userId } })).toBe(rows);
  });

  it("backs up and restores through confirmed admin HTTP routes with a retained safety copy", async () => {
    const response = await request("/api/backups", { method: "POST", headers: { cookie, origin: origin! } });
    expect(response.status).toBe(201);
    const { backup } = await response.json();
    backupIds.push(backup.id);
    expect((await request(`/api/backups/${backup.id}/restore`, { method: "POST", headers: { cookie, origin: origin! } })).status).toBe(400);
    const restored = await request(`/api/backups/${backup.id}/restore`, {
      method: "POST", headers: { cookie, origin: origin!, "x-notebook-confirmation": "RESTORE" },
    });
    expect(restored.status).toBe(200);
    const result = await restored.json();
    backupIds.push(result.safetyBackupId);
    expect(result.ok).toBe(true);
    const copy = await db.savedItem.findFirstOrThrow({ where: { userId } });
    const image = await request(`/api/saved-items/${copy.id}/article/images/${key}`, { headers: { cookie } });
    expect(Buffer.from(await image.arrayBuffer())).toEqual(raster);
  });
});
