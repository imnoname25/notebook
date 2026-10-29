"use client";
import { createContext } from "react";
import { z } from "zod";

export const editorPreferencesSchema = z.object({
  autosaveDelayMs: z.number().int().min(100).max(30_000),
  editorSpellcheck: z.boolean(),
  editorCodeLineNumbers: z.boolean(),
  editorCompactMode: z.boolean(),
  editorContentWidth: z.enum(["narrow", "normal", "wide"]),
});
export const defaultEditorPreferences: z.infer<typeof editorPreferencesSchema> = {
  autosaveDelayMs: 750, editorSpellcheck: true, editorCodeLineNumbers: false,
  editorCompactMode: false, editorContentWidth: "normal",
};
/** Workspace-scoped, never a cross-user or persistent cache. */
export const EditorPreferencesContext = createContext(defaultEditorPreferences);
export const EDITOR_PREFERENCES_EVENT = "notebook:editor-preferences";
