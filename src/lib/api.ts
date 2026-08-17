import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/errors";

export { ApiError } from "@/lib/errors";

export function validateRequestOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const configuredOrigin = process.env.APP_ORIGIN?.replace(/\/$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const requestOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : request.nextUrl.origin;
  if (origin !== (configuredOrigin ?? requestOrigin)) throw new ApiError(403, "Недопустимый источник запроса");
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Требуется авторизация");
  if (user.mustChangePassword) throw new ApiError(403, "Необходимо изменить временный пароль");
  return user;
}

export async function requireAccountUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Требуется авторизация");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new ApiError(403, "Недостаточно прав");
  return user;
}

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Некорректный JSON");
  }
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Некорректные данные", details: error.issues }, { status: 400 });
  }
  console.error(error);
  return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
}
