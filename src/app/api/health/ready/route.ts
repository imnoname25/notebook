import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/app-info";
import { readinessDiagnostic } from "@/lib/diagnostics";
export const dynamic = "force-dynamic";
export async function GET() { const result = await readinessDiagnostic(); return NextResponse.json({ status: result.ready ? "ok" : "error", app: "Notebook", version: APP_VERSION, ...result, timestamp: new Date().toISOString() }, { status: result.ready ? 200 : 503 }); }

