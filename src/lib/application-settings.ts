import { z } from "zod";

export const BACKUP_SCHEDULES = ["daily", "every_3_days", "weekly"] as const;
export const EDITOR_WIDTHS = ["narrow", "normal", "wide"] as const;
export const THEMES = ["system", "light", "dark"] as const;
export type BackupSchedule = (typeof BACKUP_SCHEDULES)[number];

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Используйте время HH:MM");
const webdavUrl = z.string().trim().max(1000).url().refine((value) => {
  const parsed = new URL(value); return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
}, "Разрешён HTTP(S) URL без credentials");
const s3Endpoint = z.string().trim().max(1000).url().refine((value) => { const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password; }, "Разрешён HTTP(S) endpoint без credentials");

export const settingsUpdateSchema = z.object({
  defaultTheme: z.enum(THEMES).optional(),
  autosaveDelayMs: z.number().int().min(500).max(5000).optional(),
  pageVersionIntervalMinutes: z.number().int().min(1).max(60).optional(),
  pageVersionRetentionDays: z.number().int().min(7).max(365).optional(),
  pageVersionMaxCount: z.number().int().min(20).max(500).optional(),
  backupEnabled: z.boolean().optional(),
  backupSchedule: z.enum(BACKUP_SCHEDULES).optional(),
  backupTime: time.optional(),
  backupRetentionCount: z.number().int().min(1).max(365).optional(),
  backupRetentionDays: z.number().int().min(1).max(3650).optional(),
  webdavEnabled: z.boolean().optional(),
  webdavUrl: webdavUrl.nullable().optional(),
  webdavUsername: z.string().trim().max(255).nullable().optional(),
  webdavPassword: z.string().max(1000).nullable().optional(),
  webdavRemoteDirectory: z.string().trim().min(1).max(500).optional(),
  s3Enabled: z.boolean().optional(),
  s3Endpoint: s3Endpoint.nullable().optional(),
  s3Region: z.string().trim().min(1).max(100).optional(),
  s3Bucket: z.string().trim().min(3).max(255).nullable().optional(),
  s3AccessKeyId: z.string().trim().min(1).max(255).nullable().optional(),
  s3SecretAccessKey: z.string().min(1).max(1000).nullable().optional(),
  s3Prefix: z.string().trim().max(500).optional(),
  s3ForcePathStyle: z.boolean().optional(),
  s3ProviderLabel: z.string().trim().max(100).nullable().optional(),
  remoteRetentionCount: z.number().int().min(1).max(1000).optional(),
  remoteRetentionDays: z.number().int().min(1).max(3650).optional(),
  editorSpellcheck: z.boolean().optional(),
  editorCodeLineNumbers: z.boolean().optional(),
  editorCompactMode: z.boolean().optional(),
  editorContentWidth: z.enum(EDITOR_WIDTHS).optional(),
}).strict();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export const SETTINGS_ID = "singleton";

export function normalizeWebdavDirectory(value: string) {
  if (value.includes("\0") || value.includes("\\")) throw new Error("Некорректный WebDAV каталог");
  const parts = value.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) throw new Error("Некорректный WebDAV каталог");
  return parts.join("/");
}

export function normalizeS3Prefix(value: string) {
  if (/[\0-\x1f\\]/u.test(value)) throw new Error("Некорректный S3 prefix");
  const parts = value.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new Error("Некорректный S3 prefix");
  return parts.join("/");
}
