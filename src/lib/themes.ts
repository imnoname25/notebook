export const THEMES = ["system", "light", "dark", "atmospheric", "studio-graphite", "studio-atelier", "midnight-ink", "paper-coffee", "forest-terminal", "nord-studio"] as const;
export type NotebookTheme = (typeof THEMES)[number];

export const THEME_LABELS: Record<NotebookTheme, string> = {
  system: "Системная",
  light: "Светлая",
  dark: "Тёмная",
  atmospheric: "Атмосферная",
  "studio-graphite": "Studio Graphite",
  "studio-atelier": "Studio Atelier",
  "midnight-ink": "Midnight Ink",
  "paper-coffee": "Paper & Coffee",
  "forest-terminal": "Forest Terminal",
  "nord-studio": "Nord Studio",
};

export function nextTheme(theme: string | undefined): NotebookTheme {
  const index = THEMES.findIndex((value) => value === theme);
  return THEMES[(index + 1) % THEMES.length]!;
}

export function isDarkTheme(theme: string | undefined) {
  return theme === "dark" || theme === "atmospheric" || theme === "studio-graphite" || theme === "midnight-ink" || theme === "forest-terminal";
}

export function themeLabel(theme: string | undefined) {
  return THEME_LABELS[THEMES.find((value) => value === theme) ?? "system"];
}

export const STUDIO_THEMES = ["studio-graphite", "studio-atelier", "midnight-ink", "paper-coffee", "forest-terminal", "nord-studio"] as const;
export function isStudioTheme(theme: string | undefined) {
  return STUDIO_THEMES.some(value => value === theme);
}
