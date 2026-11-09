"use client";

import { useState } from "react";
import { UI_FONTS, EDITOR_FONTS, FONT_LABELS, DEFAULT_APPEARANCE } from "@/lib/appearance-preferences";
import { useAppearance } from "./appearance-provider";

export function TypographySettings() {
  const { preferences, update, saving, loaded, error, retry } = useAppearance();
  const [customMode, setCustomMode] = useState(false);
  const [sizeDraft, setSizeDraft] = useState<{ base: number; text: string } | null>(null);
  const sizeText = sizeDraft?.base === preferences.editorSize ? sizeDraft.text : String(preferences.editorSize);
  function changeSize(text: string) {
    const value = Number(text);
    const valid = text !== "" && Number.isInteger(value) && value >= 12 && value <= 28;
    setSizeDraft({ base: valid ? value : preferences.editorSize, text });
    setCustomMode(true);
    if (valid) update({ editorSize: value });
  }
  return (
    <fieldset className="notebook-typography-settings mt-5 space-y-3">
    <legend className="mb-2 text-sm font-medium">Типографика</legend>
    <label>
      Шрифт интерфейса
      <select aria-label="Шрифт интерфейса" className="input mt-1" value={preferences.uiFont} onChange={event => update({ uiFont: UI_FONTS.find(font => font === event.target.value) ?? "theme" })}>
        {UI_FONTS.map(font => <option key={font} value={font}>{FONT_LABELS[font]}</option>)}
      </select>
    </label>
    <label>
      Шрифт редактора
      <select aria-label="Шрифт редактора" className="input mt-1" value={preferences.editorFont} onChange={event => update({ editorFont: EDITOR_FONTS.find(font => font === event.target.value) ?? "theme" })}>
        {EDITOR_FONTS.map(font => <option key={font} value={font}>{FONT_LABELS[font]}</option>)}
      </select>
    </label>
    <label>Размер текста
      <select aria-label="Размер текста" className="input mt-1" value={!customMode && [14, 15, 18].includes(preferences.editorSize) ? String(preferences.editorSize) : "custom"} onChange={event => {
        setCustomMode(event.target.value === "custom");
        if (event.target.value !== "custom") update({ editorSize: Number(event.target.value) });
      }}>
      <option value="14">Компактный · 14 px</option>
        <option value="15">Стандартный · 15 px</option>
        <option value="18">Увеличенный · 18 px</option>
        <option value="custom">Пользовательский</option>
    </select>
    </label>
    <label>Размер в пикселях
      <input aria-label="Размер в пикселях" className="input mt-1" type="number" min={12} max={28} value={sizeText} onChange={event => changeSize(event.target.value)} onBlur={() => setSizeDraft(null)}/></label>
    <label>Межстрочный интервал
      <select aria-label="Межстрочный интервал" className="input mt-1" value={preferences.lineHeight} onChange={event => update({ lineHeight: event.target.value as "compact" | "normal" | "relaxed" })}><option value="compact">Компактный</option>
        <option value="normal">Стандартный</option>
        <option value="relaxed">Свободный</option></select>
    </label>
    <button type="button" className="input" onClick={() => {
      setCustomMode(false);
      setSizeDraft(null);
      update({ ...DEFAULT_APPEARANCE, theme: preferences.theme });
    }}>Сбросить типографику к теме</button>
    <p role="status" className="text-xs text-muted-foreground">{saving ? "Сохранение оформления…" : error ? "Оформление не синхронизировано" : !loaded ? "Загрузка оформления…" : "Оформление сохранено в аккаунте"}</p>
    <p className="text-xs text-muted-foreground"><a href="/font-licenses.txt" target="_blank" rel="noreferrer" className="underline">Лицензии локальных шрифтов</a></p>
    {error && <div role="alert" className="text-sm text-destructive">{error}<button type="button" className="input mt-2" onClick={retry}>Повторить синхронизацию</button></div>}
    </fieldset>
  );
}
