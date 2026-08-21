import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { getToday } from "@/lib/services/today-service";

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json(await getToday(user.id));
  } catch (error) {
    return apiError(error);
  }
}
