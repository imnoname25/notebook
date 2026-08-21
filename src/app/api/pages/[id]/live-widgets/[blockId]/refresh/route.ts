import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { getLiveWidgetResult, refreshLiveWidget } from "@/lib/services/live-widget-service";

type Context = { params: Promise<{ id: string; blockId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  try { const [user, values] = await Promise.all([requireUser(), params]); return NextResponse.json({ result: await getLiveWidgetResult(user.id, values.id, values.blockId) }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: NextRequest, { params }: Context) {
  try { validateRequestOrigin(request); const [user, values] = await Promise.all([requireUser(), params]); return NextResponse.json({ result: await refreshLiveWidget(user.id, values.id, values.blockId) }); }
  catch (error) { return apiError(error); }
}
