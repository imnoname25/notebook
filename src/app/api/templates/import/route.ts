import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { templateImportSchema } from "@/lib/page-templates";
import { createTemplate } from "@/lib/services/template-service";
export async function POST(request: NextRequest) { try { validateRequestOrigin(request); const user = await requireUser(); const input = templateImportSchema.parse(await readJson(request)); return NextResponse.json({ template: await createTemplate(user.id, input.template) }, { status: 201 }); } catch (error) { return apiError(error); } }
