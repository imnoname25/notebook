import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { listAttachments } from "@/lib/services/attachment-service";

export async function GET(request: NextRequest) { try { const user = await requireUser(); const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 25) || 25)); return NextResponse.json(await listAttachments(user.id, limit, request.nextUrl.searchParams.get("cursor") ?? undefined)); } catch (error) { return apiError(error); } }
