"use client";
import { useState } from "react";
import type { LocalDraft } from "@/lib/local-drafts";
import type { PageDocument } from "./types";
import { DocumentComparison } from "./document-comparison";
export function RecoveryNotice({ drafts, page, restore, discard }: { drafts: LocalDraft[]; page: PageDocument; restore(draft: LocalDraft): Promise<void>; discard(draft: LocalDraft): Promise<void> }) {
  const [selected, setSelected] = useState(0);const [preview, setPreview] = useState(false);const [error, setError] = useState("");const [busy, setBusy] = useState(false);
  const draft = drafts[Math.min(selected, Math.max(0, drafts.length - 1))];if (!draft) return null;
  const act = async (kind: "restore" | "discard") => {
    if (kind === "discard" && !window.confirm("Удалить только этот локальный черновик и оставить серверный документ?")) return;
    if (kind === "restore" && !window.confirm("Загрузить этот черновик в редактор? Серверная версия не изменится до подтверждённого autosave; перед записью будет сохранён защитный снимок.")) return;
    setBusy(true);setError("");try { await (kind === "restore" ? restore(draft) : discard(draft));setPreview(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось обработать черновик"); } finally { setBusy(false); }
  };
  return <section className="recovery-notice notebook-no-print" aria-label="Локальный черновик">
    <strong>Найден несохранённый черновик</strong>{draft.baseRevision !== page.revision && <p>Конфликт: серверная версия изменилась. Сначала сравните состояния.</p>}
    {drafts.length > 1 && <select aria-label="Выбрать аварийный черновик" value={selected} onChange={event => { setSelected(Number(event.target.value));setPreview(false); }}>{drafts.map((item, index) => <option key={item.key} value={index}>{new Date(item.updatedAt).toLocaleString("ru")} · база r{item.baseRevision}</option>)}</select>}
    <div className="history-block-actions"><button type="button" onClick={() => setPreview(old => !old)}>Просмотреть изменения</button><button type="button" disabled={busy} onClick={() => void act("restore")}>Восстановить черновик</button><button type="button" disabled={busy} onClick={() => void act("discard")}>Оставить серверную версию</button></div>
    <small>Черновики хранятся незашифрованными в этом браузере. Записи старше 7 дней очищаются при работе приложения или следующем открытии. Выход из аккаунта очищает их. Другие приложения на устройстве не защищаются этой функцией.</small>
    {error && <p role="alert">{error}</p>}{preview && <DocumentComparison before={page} after={{ title: draft.title, content: draft.content }}/>}
  </section>;
}
