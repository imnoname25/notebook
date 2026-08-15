import { notFound, redirect } from "next/navigation";
import { NotebookApp } from "@/components/notebook/notebook-app";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export default async function PageDeepLink({ params }: { params: Promise<{ pageId: string }> }) {
  const user = await getCurrentUser(); if (!user) redirect("/login"); const { pageId } = await params;
  const page = await db.page.findFirst({ where: { id: pageId, deletedAt: null, section: { deletedAt: null, notebook: { userId: user.id, deletedAt: null } } }, select: { id: true, section: { select: { id: true, notebookId: true } } } });
  if (!page) notFound(); return <NotebookApp user={user} initialLocation={{ notebookId: page.section.notebookId, sectionId: page.section.id, pageId: page.id }}/>;
}
