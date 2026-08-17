import { NextRequest, NextResponse } from "next/server";
import { apiError, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { settingsUpdateSchema } from "@/lib/application-settings";
import { getApplicationSettings, publicSettings, updateApplicationSettings } from "@/lib/services/settings-service";

export async function GET() { try { await requireAdmin(); return NextResponse.json({ settings: publicSettings(await getApplicationSettings()) }); } catch (error) { return apiError(error); } }
export async function PATCH(request: NextRequest) { try { validateRequestOrigin(request); await requireAdmin(); const settings = await updateApplicationSettings(settingsUpdateSchema.parse(await request.json())); return NextResponse.json({ settings: publicSettings(settings) }); } catch (error) { return apiError(error); } }
