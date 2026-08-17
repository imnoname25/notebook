import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ passwordChanged?: string }> }) {
  if (await getCurrentUser()) redirect("/app");
  const needsSetup = (await db.user.count()) === 0;
  return <LoginForm needsSetup={needsSetup} passwordChanged={(await searchParams).passwordChanged === "1"} />;
}
