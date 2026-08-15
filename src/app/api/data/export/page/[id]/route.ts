import { NextRequest } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { exportPageHtmlArchive, exportPageJson, exportPageMarkdown } from "@/lib/services/export-service";
import { contentDisposition, safeDownloadName } from "@/lib/storage";
import { fileDownloadResponse } from "@/lib/download";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]); const format = request.nextUrl.searchParams.get("format") ?? "json";
    if (format === "markdown") { const result = await exportPageMarkdown(user.id, id); return new Response(result.markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": contentDisposition(`${safeDownloadName(result.title)}.md`), "x-content-type-options": "nosniff", "cache-control": "private, no-store" } }); }
    if (format === "html") { const result = await exportPageHtmlArchive(user.id, id); return fileDownloadResponse(result.filePath, `${safeDownloadName(result.title)}-html.zip`, result.directory); }
    const result = await exportPageJson(user.id, id); return new Response(JSON.stringify(result, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": contentDisposition(`${safeDownloadName(result.page.title)}.notebook.json`), "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
