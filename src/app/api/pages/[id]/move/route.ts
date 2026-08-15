import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { movePage } from "@/lib/services/move-service";
import { pageMoveSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const input = pageMoveSchema.parse(await readJson(request));
    return NextResponse.json({ page: await movePage(user.id, id, input.destinationSectionId) });
  } catch (error) { return apiError(error); }
}
