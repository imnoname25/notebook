export type Section = { id: string; notebookId: string; parentId: string | null; title: string; icon: string | null; sortOrder: number; createdAt: string; updatedAt: string };
export type Notebook = { id: string; title: string; icon: string; color: string; sortOrder: number; sections: Section[] };
export type PageSummary = { id: string; sectionId: string; title: string; sortOrder: number; isFavorite: boolean; revision: number; createdAt: string; updatedAt: string };
export type PageDocument = PageSummary & { content: unknown[] };
export type EditorSaveController = { flush(manual?: boolean): Promise<void> };
