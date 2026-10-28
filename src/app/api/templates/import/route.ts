import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { templateImportSchema } from "@/lib/page-templates";
import { createTemplate } from "@/lib/services/template-service";
import { restoreTemplateReferences, templateReferenceWarnings } from "@/lib/template-portability";
export async function POST(request: NextRequest) { try { validateRequestOrigin(request); const user = await requireUser(); const input = templateImportSchema.parse(await readJson(request)); const mapped = restoreTemplateReferences(input.template.content, new Map(), 5); const warnings = templateReferenceWarnings([input.template.content], new Map(), input.version === 1 ? 1 : 5); return NextResponse.json({ template: await createTemplate(user.id, { ...input.template, content: mapped.content }), warnings }, { status: 201 }); } catch (error) { return apiError(error); } }
