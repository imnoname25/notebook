import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/app");
  const needsSetup = (await db.user.count()) === 0;
  return <LoginForm needsSetup={needsSetup} />;
}
