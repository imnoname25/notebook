export const THEMES = ["system", "light", "dark", "atmospheric", "studio-graphite", "studio-atelier"] as const;
export type NotebookTheme = (typeof THEMES)[number];

export const THEME_LABELS: Record<NotebookTheme, string> = {
  system: "Системная",
  light: "Светлая",
  dark: "Тёмная",
  atmospheric: "Атмосферная",
  "studio-graphite": "Studio Graphite",
  "studio-atelier": "Studio Atelier",
};

export function nextTheme(theme: string | undefined): NotebookTheme {
  const index = THEMES.findIndex((value) => value === theme);
  return THEMES[(index + 1) % THEMES.length]!;
}

export function isDarkTheme(theme: string | undefined) {
  return theme === "dark" || theme === "atmospheric" || theme === "studio-graphite";
}

export function themeLabel(theme: string | undefined) {
  return THEME_LABELS[THEMES.find((value) => value === theme) ?? "system"];
}
