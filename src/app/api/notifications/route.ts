import { NextRequest, NextResponse } from "next/server";
import { apiError, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { listNotifications, markAllNotificationsRead } from "@/lib/services/system-notification-service";
export async function GET() { try { await requireAdmin(); return NextResponse.json(await listNotifications()); } catch (error) { return apiError(error); } }
export async function PATCH(request: NextRequest) { try { validateRequestOrigin(request); await requireAdmin(); await markAllNotificationsRead(); return NextResponse.json({ ok: true }); } catch (error) { return apiError(error); } }
