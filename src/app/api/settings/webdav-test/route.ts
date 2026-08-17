import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { settingsUpdateSchema } from "@/lib/application-settings";
import { decryptSettingSecret } from "@/lib/settings-encryption";
import { getApplicationSettings } from "@/lib/services/settings-service";
import { testWebdavConnection } from "@/lib/webdav";

export async function POST(request: NextRequest) {
  try { validateRequestOrigin(request); await requireAdmin(); const input = settingsUpdateSchema.pick({ webdavUrl: true, webdavUsername: true, webdavPassword: true, webdavRemoteDirectory: true }).parse(await request.json()); const stored = await getApplicationSettings(); const url = input.webdavUrl ?? stored.webdavUrl; if (!url) throw new ApiError(400, "WebDAV URL не указан"); const password = input.webdavPassword === undefined ? stored.webdavPasswordEncrypted ? decryptSettingSecret(stored.webdavPasswordEncrypted) : null : input.webdavPassword; await testWebdavConnection({ url, username: input.webdavUsername ?? stored.webdavUsername, password, remoteDirectory: input.webdavRemoteDirectory ?? stored.webdavRemoteDirectory }); return NextResponse.json({ ok: true }); }
  catch (error) { return apiError(error); }
}
