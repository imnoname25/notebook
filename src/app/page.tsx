import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export default async function HomePage() {
  redirect((await getCurrentUser()) ? "/app" : "/login");
}
