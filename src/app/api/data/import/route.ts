import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { commitImport, disposePreparedImport, prepareImport } from "@/lib/services/import-service";
import { withDataOperation } from "@/lib/operation-lock";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try { validateRequestOrigin(request); const user = await requireUser(); const destinationSectionId = request.nextUrl.searchParams.get("sectionId") ?? undefined; return await withDataOperation("импорт", async () => { const prepared = await prepareImport(request); try { return NextResponse.json({ result: await commitImport(user.id, prepared, destinationSectionId) }, { status: 201 }); } finally { await disposePreparedImport(prepared); } }); }
  catch (error) { return apiError(error); }
}
