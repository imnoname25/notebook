export const THEMES = ["system", "light", "dark", "atmospheric", "studio-graphite", "studio-atelier", "midnight-ink", "paper-coffee", "forest-terminal", "nord-studio"] as const;
export type NotebookTheme = (typeof THEMES)[number];

type ThemeDefinition = {
  label: string;
  dark: boolean;
  identity?: "cyberdeck" | "writer" | "signal" | "creative";
  fonts?: { ui: string; editor: string; title: string };
};

export const THEME_REGISTRY: Record<NotebookTheme, ThemeDefinition> = {
  system: { label: "Системная", dark: false },
  light: { label: "Светлая", dark: false },
  dark: { label: "Тёмная", dark: true },
  atmospheric: { label: "Атмосферная", dark: true },
  "studio-graphite": { label: "Studio Graphite", dark: true },
  "studio-atelier": { label: "Studio Atelier", dark: false },
  "midnight-ink": { label: "Cyberdeck", dark: true, identity: "cyberdeck", fonts: { ui: "ibm-plex-sans", editor: "ibm-plex-sans", title: "ibm-plex-sans" } },
  "paper-coffee": { label: "Writer", dark: false, identity: "writer", fonts: { ui: "source-sans-3", editor: "literata", title: "literata" } },
  "forest-terminal": { label: "Signal", dark: false, identity: "signal", fonts: { ui: "geist", editor: "source-sans-3", title: "manrope" } },
  "nord-studio": { label: "Creative", dark: false, identity: "creative", fonts: { ui: "manrope", editor: "inter", title: "manrope" } },
};
export const THEME_LABELS = Object.fromEntries(THEMES.map(theme => [theme, THEME_REGISTRY[theme].label])) as Record<NotebookTheme, string>;

export function themeDefinition(theme: string | undefined) {
  return THEME_REGISTRY[THEMES.find(value => value === theme) ?? "system"];
}

export function nextTheme(theme: string | undefined): NotebookTheme {
  const index = THEMES.findIndex((value) => value === theme);
  return THEMES[(index + 1) % THEMES.length]!;
}

export function isDarkTheme(theme: string | undefined) {
  return themeDefinition(theme).dark;
}

export function themeLabel(theme: string | undefined) {
  return themeDefinition(theme).label;
}

export const STUDIO_THEMES = ["studio-graphite", "studio-atelier", "midnight-ink", "paper-coffee", "forest-terminal", "nord-studio"] as const;
export function isStudioTheme(theme: string | undefined) {
  return STUDIO_THEMES.some(value => value === theme);
}
