import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { apiError } from "@/lib/api";

export async function GET() {
  try {
    const [user, userCount] = await Promise.all([getCurrentUser(), db.user.count()]);
    return NextResponse.json({ authenticated: Boolean(user), needsSetup: userCount === 0, user });
  } catch (error) {
    return apiError(error);
  }
}
