import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { safeDownloadName } from "@/lib/storage";
import { templateExport } from "@/lib/services/template-service";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) { try { const [user, { id }] = await Promise.all([requireUser(), params]); const data = await templateExport(user.id, id); return new NextResponse(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${safeDownloadName(data.template.name)}.notebook-template.json"`, "cache-control": "private, no-store" } }); } catch (error) { return apiError(error); } }
