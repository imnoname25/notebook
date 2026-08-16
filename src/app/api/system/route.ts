import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { APP_CHANNEL, APP_REVISION, APP_VERSION } from "@/lib/app-info";
import { db } from "@/lib/db";
import { readinessDiagnostic } from "@/lib/diagnostics";
import { getApplicationSettings, publicSettings } from "@/lib/services/settings-service";
import { serializeBackup } from "@/lib/services/backup-service";

export async function GET() {
  try {
    const user = await requireUser();
    const [diagnostics, settings, pages, versions, attachments, templates, notifications, remoteBackups, lastBackup] = await Promise.all([
      readinessDiagnostic(), getApplicationSettings(), db.page.count({ where: { section: { notebook: { userId: user.id } } } }), db.pageVersion.count({ where: { page: { section: { notebook: { userId: user.id } } } } }), db.upload.count({ where: { userId: user.id } }), db.pageTemplate.count({ where: { userId: user.id } }), db.systemNotification.count({ where: { readAt: null, resolvedAt: null } }), db.backupRemoteCopy.count({ where: { status: "success" } }), db.backupRecord.findFirst({ orderBy: { createdAt: "desc" }, include: { remoteCopies: true } }),
    ]);
    return NextResponse.json({ system: { version: APP_VERSION, revision: APP_REVISION, channel: APP_CHANNEL, nodeVersion: process.version, environment: process.env.NODE_ENV ?? "development", diagnostics, counts: { pages, versions, attachments, templates, notifications, remoteBackups }, lastBackup: lastBackup ? serializeBackup(lastBackup) : null, settings: publicSettings(settings) } });
  } catch (error) { return apiError(error); }
}
