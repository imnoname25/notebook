import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { disposePreparedImport, prepareImport } from "@/lib/services/import-service";
import { withDataOperation } from "@/lib/operation-lock";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try { validateRequestOrigin(request); await requireUser(); return await withDataOperation("проверка импорта", async () => { const prepared = await prepareImport(request); try { return NextResponse.json({ summary: prepared.summary }); } finally { await disposePreparedImport(prepared); } }); }
  catch (error) { return apiError(error); }
}
