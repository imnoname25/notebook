import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/app-info";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ status: "ok", app: "Notebook", version: APP_VERSION, timestamp: new Date().toISOString() }); }

