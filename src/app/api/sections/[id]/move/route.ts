import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireUser, validateRequestOrigin } from "@/lib/api";
import { moveSection } from "@/lib/services/move-service";
import { sectionMoveSchema } from "@/lib/validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Context) {
  try {
    validateRequestOrigin(request);
    const [user, { id }] = await Promise.all([requireUser(), params]);
    const input = sectionMoveSchema.parse(await readJson(request));
    return NextResponse.json({ section: await moveSection(user.id, id, input.destinationNotebookId) });
  } catch (error) { return apiError(error); }
}
