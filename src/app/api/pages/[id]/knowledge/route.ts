import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { getPageKnowledge } from "@/lib/services/page-link-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]);
    return NextResponse.json(await getPageKnowledge(user.id, id));
  } catch (error) {
    return apiError(error);
  }
}
