import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { templateCreateSchema, templateReorderSchema } from "@/lib/page-templates";
import { createTemplate, listTemplates, reorderTemplates } from "@/lib/services/template-service";

export async function GET() { try { const user = await requireUser(); return NextResponse.json({ templates: await listTemplates(user.id) }); } catch (error) { return apiError(error); } }
export async function POST(request: NextRequest) { try { validateRequestOrigin(request); const user = await requireUser(); const input = templateCreateSchema.parse(await readJson(request)); return NextResponse.json({ template: await createTemplate(user.id, input) }, { status: 201 }); } catch (error) { return apiError(error); } }
export async function PATCH(request: NextRequest) { try { validateRequestOrigin(request); const user = await requireUser(); const input = templateReorderSchema.parse(await readJson(request)); await reorderTemplates(user.id, input.ids); return NextResponse.json({ ok: true }); } catch (error) { return apiError(error); } }
