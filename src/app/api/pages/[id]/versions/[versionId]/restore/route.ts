import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { restorePageVersion } from "@/lib/services/page-version-service";
import { restoreVersionSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string; versionId: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id, versionId }] = await Promise.all([requireUser(), params]);
    const input = restoreVersionSchema.parse(await readJson(request));
    return NextResponse.json({ page: await restorePageVersion(user.id, id, versionId, input.expectedRevision) });
  } catch (error) { return apiError(error); }
}
