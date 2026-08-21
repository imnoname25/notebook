import { NextResponse } from "next/server";
import { apiError, requireUser } from "@/lib/api";
import { getNotebookOverview } from "@/lib/services/notebook-overview-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const [user, { id }] = await Promise.all([requireUser(), params]);
    return NextResponse.json(await getNotebookOverview(user.id, id));
  } catch (error) {
    return apiError(error);
  }
}
