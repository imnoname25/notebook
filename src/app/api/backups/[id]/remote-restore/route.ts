import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { withDataOperation } from "@/lib/operation-lock";
import { restoreRemoteBackup } from "@/lib/services/backup-restore-service";
type Context = { params: Promise<{ id: string }> };
const inputSchema = z.object({ provider: z.enum(["webdav", "s3"]) }).strict();
export async function POST(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); const [user, { id }] = await Promise.all([requireUser(), params]); if (request.headers.get("x-notebook-confirmation") !== "RESTORE") throw new ApiError(400, "Введите RESTORE для подтверждения"); const input = inputSchema.parse(await readJson(request)); return await withDataOperation("restore remote backup", async () => NextResponse.json(await restoreRemoteBackup(user.id, id, input.provider))); } catch (error) { return apiError(error); } }
