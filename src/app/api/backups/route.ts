import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { createOperationalBackup, listBackups, serializeBackup } from "@/lib/services/backup-service";
import { withDataOperation } from "@/lib/operation-lock";

const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().min(1).optional() });
export async function GET(request: NextRequest) { try { await requireAdmin(); const input = listSchema.parse(Object.fromEntries(request.nextUrl.searchParams)); return NextResponse.json(await listBackups(input.limit, input.cursor)); } catch (error) { return apiError(error); } }
export async function POST(request: NextRequest) { try { validateRequestOrigin(request); const user = await requireAdmin(); return await withDataOperation("manual backup", async () => NextResponse.json({ backup: serializeBackup(await createOperationalBackup(user.id, "manual")) }, { status: 201 })); } catch (error) { return apiError(error); } }
