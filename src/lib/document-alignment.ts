import { z } from "zod";

export const DOCUMENT_ALIGNMENT_KEY = "notebook:document-alignment";
export const documentAlignmentSchema = z.enum(["left", "center"]);
export type DocumentAlignment = z.infer<typeof documentAlignmentSchema>;

export function resolveDocumentAlignment(value: unknown): DocumentAlignment {
  const result = documentAlignmentSchema.safeParse(value);
  return result.success ? result.data : "left";
}
