export const CALLOUT_LABELS = { info: "Информация", note: "Совет", warning: "Предупреждение", error: "Ошибка", success: "Успех" } as const;

/** Presets reuse existing kinds; no new block type or persisted enum is introduced. */
export const CALLOUT_PRESETS = [
  { key: "info", kind: "info", title: "" },
  { key: "important", kind: "warning", title: "Важно" },
  { key: "warning", kind: "warning", title: "" },
  { key: "idea", kind: "note", title: "Идея" },
  { key: "note", kind: "note", title: "" },
  { key: "success", kind: "success", title: "" },
  { key: "error", kind: "error", title: "" },
] as const;
