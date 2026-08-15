import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { settingsUpdateSchema } from "@/lib/application-settings";
import { S3BackupTarget } from "@/lib/s3-backup";
import { decryptSettingSecret } from "@/lib/settings-encryption";
import { getApplicationSettings } from "@/lib/services/settings-service";

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request); await requireUser(); const input = settingsUpdateSchema.pick({ s3Endpoint: true, s3Region: true, s3Bucket: true, s3AccessKeyId: true, s3SecretAccessKey: true, s3Prefix: true, s3ForcePathStyle: true }).parse(await readJson(request)); const stored = await getApplicationSettings();
    const bucket = input.s3Bucket ?? stored.s3Bucket; const accessKeyId = input.s3AccessKeyId ?? stored.s3AccessKeyId; const secretAccessKey = input.s3SecretAccessKey ?? (stored.s3SecretAccessKeyEncrypted ? decryptSettingSecret(stored.s3SecretAccessKeyEncrypted) : null);
    if (!bucket || !accessKeyId || !secretAccessKey) throw new ApiError(400, "S3 настроен не полностью");
    await new S3BackupTarget({ endpoint: input.s3Endpoint ?? stored.s3Endpoint, region: input.s3Region ?? stored.s3Region, bucket, accessKeyId, secretAccessKey, prefix: input.s3Prefix ?? stored.s3Prefix, forcePathStyle: input.s3ForcePathStyle ?? stored.s3ForcePathStyle }).test();
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
