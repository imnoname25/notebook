import { z } from "zod";
import { THEMES } from "./themes";

export const UI_FONTS = ["theme", "inter", "geist", "ibm-plex-sans", "manrope", "source-sans-3"] as const;
export const EDITOR_FONTS = ["theme", "inter", "literata", "ibm-plex-sans", "source-sans-3", "jetbrains-mono"] as const;
export const FONT_LABELS: Record<string, string> = {
  theme: "По умолчанию темы", inter: "Inter", geist: "Geist", "ibm-plex-sans": "IBM Plex Sans",
  manrope: "Manrope", "source-sans-3": "Source Sans 3", literata: "Literata", "jetbrains-mono": "JetBrains Mono",
};
const fields = {
  theme: z.enum(THEMES),
  uiFont: z.enum(UI_FONTS),
  editorFont: z.enum(EDITOR_FONTS),
  editorSize: z.number().int().min(12).max(28),
  lineHeight: z.enum(["compact", "normal", "relaxed"]),
};
export const appearanceSchema = z.object({
  theme: fields.theme.default("system"),
  uiFont: fields.uiFont.default("theme"),
  editorFont: fields.editorFont.default("theme"),
  editorSize: fields.editorSize.default(15),
  lineHeight: fields.lineHeight.default("normal"),
}).strict();
// PATCH fields deliberately have no defaults: an omitted field must stay omitted.
export const appearancePatchSchema = z.object(fields).partial().strict();
export type AppearancePreferences = z.infer<typeof appearanceSchema>;
export const DEFAULT_APPEARANCE = appearanceSchema.parse({});
export const THEME_FONTS: Record<string, { ui: string; editor: string }> = {
  "midnight-ink": { ui: "ibm-plex-sans", editor: "ibm-plex-sans" },
  "paper-coffee": { ui: "source-sans-3", editor: "literata" },
  "forest-terminal": { ui: "geist", editor: "inter" },
  "nord-studio": { ui: "manrope", editor: "inter" },
};
export function normalizeAppearance(input: unknown): AppearancePreferences {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    theme: appearanceSchema.shape.theme.safeParse(value.theme).data ?? DEFAULT_APPEARANCE.theme,
    uiFont: appearanceSchema.shape.uiFont.safeParse(value.uiFont).data ?? DEFAULT_APPEARANCE.uiFont,
    editorFont: appearanceSchema.shape.editorFont.safeParse(value.editorFont).data ?? DEFAULT_APPEARANCE.editorFont,
    editorSize: appearanceSchema.shape.editorSize.safeParse(value.editorSize).data ?? DEFAULT_APPEARANCE.editorSize,
    lineHeight: appearanceSchema.shape.lineHeight.safeParse(value.lineHeight).data ?? DEFAULT_APPEARANCE.lineHeight,
  };
}
