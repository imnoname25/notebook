export const ACCENT_COLORS = ["default", "slate", "blue", "cyan", "green", "yellow", "orange", "red", "pink", "violet", "indigo"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

export const ACCENT_LABELS: Record<AccentColor, string> = {
  default: "Без цвета", slate: "Серый", blue: "Синий", cyan: "Бирюзовый", green: "Зелёный", yellow: "Жёлтый",
  orange: "Оранжевый", red: "Красный", pink: "Розовый", violet: "Фиолетовый", indigo: "Индиго",
};
export const ACCENT_DOT_CLASSES: Record<AccentColor, string> = {
  default: "text-muted-foreground", slate: "text-slate-500", blue: "text-blue-500", cyan: "text-cyan-500", green: "text-green-500",
  yellow: "text-yellow-500", orange: "text-orange-500", red: "text-red-500", pink: "text-pink-500", violet: "text-violet-500", indigo: "text-indigo-500",
};
export const ACCENT_BG_CLASSES: Record<AccentColor, string> = {
  default: "bg-muted", slate: "bg-slate-500", blue: "bg-blue-500", cyan: "bg-cyan-500", green: "bg-green-500",
  yellow: "bg-yellow-500", orange: "bg-orange-500", red: "bg-red-500", pink: "bg-pink-500", violet: "bg-violet-500", indigo: "bg-indigo-500",
};
export function isAccentColor(value: string): value is AccentColor { return (ACCENT_COLORS as readonly string[]).includes(value); }
export function isPageIcon(value: string | null): boolean { return value === null || (value.length <= 16 && !/[\p{L}\p{N}<>]/u.test(value)); }
