import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { templateUpdateSchema } from "@/lib/page-templates";
import { deleteTemplate, updateTemplate } from "@/lib/services/template-service";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); const [user, { id }] = await Promise.all([requireUser(), params]); return NextResponse.json({ template: await updateTemplate(user.id, id, templateUpdateSchema.parse(await readJson(request))) }); } catch (error) { return apiError(error); } }
export async function DELETE(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); const [user, { id }] = await Promise.all([requireUser(), params]); await deleteTemplate(user.id, id); return NextResponse.json({ ok: true }); } catch (error) { return apiError(error); } }
