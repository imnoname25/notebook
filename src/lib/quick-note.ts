export type QuickNote = {
  id: string; title: string; body: string; color: string; icon: string | null;
  isPinned: boolean; sortOrder: number; status: "INBOX" | "ARCHIVED" | "CONVERTED"; archivedAt: string | null;
  createdAt: string; updatedAt: string;
  tags: { tag: { name: string; normalized: string } }[];
};
export type QuickNotePatch = Partial<Pick<QuickNote, "title" | "body" | "color" | "icon" | "isPinned">> & { archived?: boolean };
