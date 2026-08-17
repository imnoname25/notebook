import { NextRequest, NextResponse } from "next/server";
import { apiError, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { markNotificationRead } from "@/lib/services/system-notification-service";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); await requireAdmin(); const { id } = await params; return NextResponse.json({ notification: await markNotificationRead(id) }); } catch (error) { return apiError(error); } }
