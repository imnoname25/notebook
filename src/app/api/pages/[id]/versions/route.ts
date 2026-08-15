import { NextRequest, NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { listPageVersions } from "@/lib/services/page-version-service";
import { versionListSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const input = versionListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listPageVersions(user.id, id, input.limit, input.cursor));
  } catch (error) { return apiError(error); }
}
