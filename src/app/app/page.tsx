import { redirect } from "next/navigation";
import { NotebookApp } from "@/components/notebook/notebook-app";
import { getCurrentUser } from "@/lib/auth/session";

export default async function AppPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <NotebookApp user={user} />;
}
