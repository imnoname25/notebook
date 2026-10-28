import { canonicalJson } from "./document-state";
export type TemplateEditorState = { name: string; description: string; icon: string; content: unknown[] };
/** Capture after BlockNote construction; selection and persisted timestamps are not document edits. */
export function templateEditorFingerprint(state: TemplateEditorState) { return canonicalJson(state); }
