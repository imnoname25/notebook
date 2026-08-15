import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser, validateRequestOrigin } from "@/lib/api";
import { duplicateTemplate } from "@/lib/services/template-service";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Context) { try { validateRequestOrigin(request); const [user, { id }] = await Promise.all([requireUser(), params]); return NextResponse.json({ template: await duplicateTemplate(user.id, id) }, { status: 201 }); } catch (error) { return apiError(error); } }
