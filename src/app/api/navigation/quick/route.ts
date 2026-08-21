import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { getQuickSwitcher } from "@/lib/services/quick-switcher-service";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await getQuickSwitcher(user.id));
  } catch (error) {
    return apiError(error);
  }
}
