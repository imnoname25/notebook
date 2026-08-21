import { extractBlockNoteText } from "./blocknote-text";

export type PageOutlineItem = { id: string; title: string; level: 1 | 2 | 3 };

export function extractPageOutline(value: unknown): PageOutlineItem[] {
  if (!Array.isArray(value)) return [];
  const items: PageOutlineItem[] = [];
  const visit = (blocks: unknown[]) => {
    blocks.forEach((candidate, index) => {
      if (!candidate || typeof candidate !== "object") return;
      const block = candidate as Record<string, unknown>;
      if (block.type === "heading") {
        const props = block.props && typeof block.props === "object" ? block.props as Record<string, unknown> : {};
        const rawLevel = Number(props.level);
        const level = (rawLevel >= 1 && rawLevel <= 3 ? rawLevel : 1) as 1 | 2 | 3;
        const title = extractBlockNoteText(block.content);
        if (title) items.push({ id: typeof block.id === "string" ? block.id : `heading-${items.length}-${index}`, title, level });
      }
      if (Array.isArray(block.children)) visit(block.children);
    });
  };
  visit(value);
  return items;
}
