import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { adminUserCreateSchema } from "@/lib/validation";
import { createManagedUser, listUsers } from "@/lib/services/user-management-service";

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ users: await listUsers() });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const admin = await requireAdmin();
    const user = await createManagedUser(admin.id, adminUserCreateSchema.parse(await readJson(request)));
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) { return apiError(error); }
}
