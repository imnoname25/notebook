"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { THEMES, THEME_LABELS, STUDIO_THEMES, isStudioTheme, isDarkTheme } from "@/lib/themes";

const subscribe = () => () => {};

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return <fieldset className="space-y-2">
    <legend className="mb-2 text-sm font-medium">Тема оформления</legend>
    <div className="notebook-theme-choices grid grid-cols-2 gap-2 sm:grid-cols-3">
      {[...STUDIO_THEMES, ...THEMES.filter(value => !isStudioTheme(value))].map((value) => <button key={value} type="button" className={`notebook-theme-option ${isStudioTheme(value) ? "notebook-studio-theme-option" : ""}`} aria-label={THEME_LABELS[value]} data-theme-choice={value} aria-pressed={mounted && theme === value} onClick={() => setTheme(value)}>
        <span className="notebook-theme-preview" aria-hidden="true"><span/><span/></span>
        <span>{THEME_LABELS[value]}</span><small>{value === "system" ? "По устройству" : isDarkTheme(value) ? "Тёмная" : "Светлая"}</small>
      </button>)}
    </div>
    <p className="text-xs leading-5 text-muted-foreground">Выбор сохраняется в этом браузере. Системная тема следует настройкам устройства.</p>
  </fieldset>;
}
