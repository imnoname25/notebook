export type Section = {
  id: string;
  notebookId: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
export type Notebook = {
  id: string;
  title: string;
  icon: string;
  color: string;
  sortOrder: number;
  sections: Section[];
};
export type PageSummary = {
  id: string;
  sectionId: string;
  title: string;
  icon: string | null;
  color: string;
  coverUploadId: string | null;
  backgroundType: PageBackgroundType;
  backgroundColor: string;
  backgroundGradient: PageGradient | null;
  backgroundPattern: PagePattern;
  backgroundUploadId: string | null;
  backgroundPosition: PageBackgroundPosition;
  backgroundOverlay: PageBackgroundOverlay;
  appearancePreset: PageAppearancePreset | null;
  previewText?: string;
  sortOrder: number;
  isFavorite: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type PageDocument = PageSummary & { content: unknown[] };
export type EditorSaveController = {
  flush(manual?: boolean): Promise<void>;
  scrollToBlock(blockId: string): void;
};
import type {
  PageAppearancePreset,
  PageBackgroundOverlay,
  PageBackgroundPosition,
  PageBackgroundType,
  PageGradient,
  PagePattern,
} from "@/lib/content-appearance";
