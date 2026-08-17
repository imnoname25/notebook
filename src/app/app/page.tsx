import { redirect } from "next/navigation";
import { NotebookApp } from "@/components/notebook/notebook-app";
import { getCurrentUser } from "@/lib/auth/session";
import { RequiredPasswordChange } from "@/components/auth/required-password-change";

export default async function AppPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) return <RequiredPasswordChange />;
  return <NotebookApp user={user} />;
}
