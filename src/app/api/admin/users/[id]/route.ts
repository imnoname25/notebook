import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireAdmin, validateRequestOrigin } from "@/lib/api";
import { adminUserUpdateSchema } from "@/lib/validation";
import { updateManagedUser } from "@/lib/services/user-management-service";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    validateRequestOrigin(request);
    const admin = await requireAdmin();
    const { id } = await context.params;
    const result = await updateManagedUser(admin.id, id, adminUserUpdateSchema.parse(await readJson(request)));
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
