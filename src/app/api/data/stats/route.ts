import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { storageStats } from "@/lib/services/attachment-service";
export async function GET() { try { const user = await requireUser(); return NextResponse.json({ stats: await storageStats(user.id) }); } catch (error) { return apiError(error); } }
