import { z } from "zod";
export const pageLinkPropsSchema = z.object({ pageId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), text: z.string(), alias: z.boolean() });
export const linkTargetSchema = z.object({ id: z.string(), title: z.string(), sectionTitle: z.string(), notebookTitle: z.string() });
export type LinkTarget = z.infer<typeof linkTargetSchema>;
export const linkTargetsSchema = z.object({ pages: z.array(linkTargetSchema) });
export function linkedPageId(node: Record<string, unknown>): string | null {
  if (node.type === "pageLink") { const parsed = pageLinkPropsSchema.safeParse(node.props);return parsed.success ? parsed.data.pageId : null; }
  if (node.type === "link" && typeof node.href === "string") return /^\/pages\/([A-Za-z0-9_-]+)(?:[?#].*)?$/.exec(node.href)?.[1] ?? null;
  return null;
}
