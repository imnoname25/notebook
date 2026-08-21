export const ACCENT_COLORS = [
  "default",
  "neutral",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

export const ACCENT_LABELS: Record<AccentColor, string> = {
  default: "По умолчанию",
  neutral: "Нейтральный",
  red: "Красный",
  orange: "Оранжевый",
  amber: "Янтарный",
  yellow: "Жёлтый",
  lime: "Лаймовый",
  green: "Зелёный",
  teal: "Бирюзовый",
  cyan: "Голубой",
  blue: "Синий",
  indigo: "Индиго",
  violet: "Фиолетовый",
  pink: "Розовый",
};

export const ACCENT_DOT_CLASSES: Record<AccentColor, string> = {
  default: "text-muted-foreground",
  neutral: "text-slate-500",
  red: "text-red-500",
  orange: "text-orange-500",
  amber: "text-amber-500",
  yellow: "text-yellow-500",
  lime: "text-lime-500",
  green: "text-green-500",
  teal: "text-teal-500",
  cyan: "text-cyan-500",
  blue: "text-blue-500",
  indigo: "text-indigo-500",
  violet: "text-violet-500",
  pink: "text-pink-500",
};

export const ACCENT_BG_CLASSES: Record<AccentColor, string> = {
  default: "bg-muted",
  neutral: "bg-slate-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  yellow: "bg-yellow-500",
  lime: "bg-lime-500",
  green: "bg-green-500",
  teal: "bg-teal-500",
  cyan: "bg-cyan-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

export const PAGE_BACKGROUND_TYPES = [
  "default",
  "solid",
  "tint",
  "gradient",
  "image",
  "pattern",
] as const;
export const PAGE_PATTERNS = [
  "plain",
  "ruled",
  "grid",
  "dot-grid",
  "fine-grid",
  "paper",
  "blueprint",
] as const;
export const PAGE_GRADIENTS = [
  "dusk",
  "ocean",
  "forest",
  "sunset",
  "lavender",
  "graphite",
  "aurora",
  "warm-paper",
] as const;
export const PAGE_BACKGROUND_POSITIONS = ["top", "center", "bottom"] as const;
export const PAGE_BACKGROUND_OVERLAYS = [
  "none",
  "light",
  "medium",
  "strong",
] as const;
export const PAGE_APPEARANCE_PRESETS = [
  "default",
  "minimal",
  "paper",
  "dark-grid",
  "warm-notes",
  "ocean",
  "focus",
] as const;
export const SECTION_ACCENT_INTENSITIES = [
  "minimal",
  "moderate",
  "expressive",
] as const;
export const PAGE_LIST_VIEWS = ["compact", "standard", "preview"] as const;

export type PageBackgroundType = (typeof PAGE_BACKGROUND_TYPES)[number];
export type PagePattern = (typeof PAGE_PATTERNS)[number];
export type PageGradient = (typeof PAGE_GRADIENTS)[number];
export type PageBackgroundPosition = (typeof PAGE_BACKGROUND_POSITIONS)[number];
export type PageBackgroundOverlay = (typeof PAGE_BACKGROUND_OVERLAYS)[number];
export type PageAppearancePreset = (typeof PAGE_APPEARANCE_PRESETS)[number];
export type SectionAccentIntensity =
  (typeof SECTION_ACCENT_INTENSITIES)[number];
export type PageListView = (typeof PAGE_LIST_VIEWS)[number];

export const PAGE_PATTERN_LABELS: Record<PagePattern, string> = {
  plain: "Без узора",
  ruled: "Линейка",
  grid: "Сетка",
  "dot-grid": "Точки",
  "fine-grid": "Мелкая сетка",
  paper: "Бумага",
  blueprint: "Чертёж",
};
export const PAGE_GRADIENT_LABELS: Record<PageGradient, string> = {
  dusk: "Сумерки",
  ocean: "Океан",
  forest: "Лес",
  sunset: "Закат",
  lavender: "Лаванда",
  graphite: "Графит",
  aurora: "Северное сияние",
  "warm-paper": "Тёплая бумага",
};
export const PAGE_PRESET_LABELS: Record<PageAppearancePreset, string> = {
  default: "По умолчанию",
  minimal: "Минимализм",
  paper: "Бумага",
  "dark-grid": "Тёмная сетка",
  "warm-notes": "Тёплые заметки",
  ocean: "Океан",
  focus: "Фокус",
};

export type PageAppearanceData = {
  color: AccentColor;
  backgroundType: PageBackgroundType;
  backgroundColor: AccentColor;
  backgroundGradient: PageGradient | null;
  backgroundPattern: PagePattern;
  backgroundUploadId: string | null;
  backgroundPosition: PageBackgroundPosition;
  backgroundOverlay: PageBackgroundOverlay;
  appearancePreset: PageAppearancePreset | null;
};

export function pagePresetAppearance(
  preset: PageAppearancePreset,
): Omit<PageAppearanceData, "backgroundUploadId"> {
  const base = {
    color: "default",
    backgroundType: "default",
    backgroundColor: "default",
    backgroundGradient: null,
    backgroundPattern: "plain",
    backgroundPosition: "center",
    backgroundOverlay: "medium",
    appearancePreset: preset,
  } satisfies Omit<PageAppearanceData, "backgroundUploadId">;
  if (preset === "minimal") return { ...base, appearancePreset: preset };
  if (preset === "paper")
    return {
      ...base,
      color: "amber",
      backgroundType: "pattern",
      backgroundColor: "amber",
      backgroundPattern: "paper",
    };
  if (preset === "dark-grid")
    return {
      ...base,
      color: "cyan",
      backgroundType: "pattern",
      backgroundColor: "neutral",
      backgroundPattern: "blueprint",
    };
  if (preset === "warm-notes")
    return {
      ...base,
      color: "orange",
      backgroundType: "tint",
      backgroundColor: "amber",
    };
  if (preset === "ocean")
    return {
      ...base,
      color: "blue",
      backgroundType: "gradient",
      backgroundColor: "blue",
      backgroundGradient: "ocean",
    };
  if (preset === "focus")
    return {
      ...base,
      color: "indigo",
      backgroundType: "tint",
      backgroundColor: "neutral",
    };
  return { ...base, appearancePreset: null };
}

export function resetPageAppearance(): PageAppearanceData {
  return { ...pagePresetAppearance("default"), backgroundUploadId: null };
}

export function isAccentColor(value: string): value is AccentColor {
  return (ACCENT_COLORS as readonly string[]).includes(value);
}
export function isPageIcon(value: string | null): boolean {
  return (
    value === null || (value.length <= 16 && !/[\p{L}\p{N}<>]/u.test(value))
  );
}
export function valueFromAllowlist<T extends string>(
  value: string | null | undefined,
  values: readonly T[],
  fallback: T,
): T {
  return value && (values as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}
export function resolveAppearanceAccent(
  pageColor?: string | null,
  sectionColor?: string | null,
  notebookColor?: string | null,
): AccentColor {
  for (const candidate of [
    pageColor,
    sectionColor,
    notebookColor === "slate"
      ? "neutral"
      : notebookColor === "brown"
        ? "amber"
        : notebookColor,
  ]) {
    if (candidate && candidate !== "default" && isAccentColor(candidate))
      return candidate;
  }
  return "default";
}
