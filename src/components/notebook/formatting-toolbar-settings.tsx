"use client";
import { useAppearance } from "./appearance-provider";

export function FormattingToolbarSettings() {
  const { preferences, update, saving, loaded, error, retry } = useAppearance();
  return <div className="space-y-2">
    <label className="block text-sm">Панель форматирования
      <select aria-label="Панель форматирования" className="input mt-1" value={preferences.formattingToolbarMode} onChange={event => update({ formattingToolbarMode: event.target.value === "compact" ? "compact" : "full" })}>
        <option value="compact">Компактная</option><option value="full">Полная</option>
      </select>
    </label>
    <p className="text-xs text-muted-foreground" role="status">{error ? "Режим панели не синхронизирован" : saving ? "Сохранение режима панели…" : !loaded ? "Загрузка режима панели…" : "Режим панели сохранён в аккаунте"}</p>
    {error && <button type="button" onClick={retry}>Повторить синхронизацию</button>}
  </div>;
}
