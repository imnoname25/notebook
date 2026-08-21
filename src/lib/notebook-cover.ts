export const NOTEBOOK_COVER_TYPES = ["none", "solid", "gradient", "image"] as const;
export const NOTEBOOK_COVER_GRADIENTS = ["graphite", "ocean", "forest", "sunset", "lavender", "amber", "night", "aurora"] as const;
export type NotebookCoverType = (typeof NOTEBOOK_COVER_TYPES)[number];
export type NotebookCoverGradient = (typeof NOTEBOOK_COVER_GRADIENTS)[number];

export const NOTEBOOK_COVER_LABELS: Record<NotebookCoverGradient, string> = {
  graphite: "Графит", ocean: "Океан", forest: "Лес", sunset: "Закат",
  lavender: "Лаванда", amber: "Янтарь", night: "Ночь", aurora: "Аврора",
};

export function notebookCoverValue(type: NotebookCoverType, value: string | null | undefined) {
  if (type === "none" || type === "image") return null;
  if (type === "solid") return value && /^[a-z]+$/.test(value) ? value : "slate";
  return NOTEBOOK_COVER_GRADIENTS.includes(value as NotebookCoverGradient) ? value as NotebookCoverGradient : "graphite";
}
