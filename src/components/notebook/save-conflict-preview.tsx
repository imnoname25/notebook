"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { api } from "@/lib/client-api";
import type { DocumentState } from "@/lib/document-state";
import { DocumentComparison } from "./document-comparison";
const schema = z.object({ page: z.object({ id: z.string(), title: z.string(), content: z.array(z.unknown()), revision: z.number() }) });
export function SaveConflictPreview({ pageId, draft, persist, onClose }: { pageId: string; draft(): DocumentState; persist(): Promise<void>; onClose(): void }) {
  const readDraft = useRef(draft);useLayoutEffect(() => { readDraft.current = draft; });
  const [comparison, setComparison] = useState<{ before: DocumentState; after: DocumentState; revision: number } | null>(null);
  const [error, setError] = useState("");const [refresh, setRefresh] = useState(0);const [busy, setBusy] = useState(false);
  // A deliberate snapshot, not a diff recomputed on every keystroke.
  useEffect(() => {
    const controller = new AbortController();
    void api<unknown>(`/api/pages/${pageId}`, { signal: controller.signal }).then(value => { const { page } = schema.parse(value);if (!controller.signal.aborted) { setComparison({ before: page, after: readDraft.current(), revision: page.revision });setError(""); } }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Сервер недоступен; черновик остаётся на устройстве"); });
    return () => controller.abort();
  }, [pageId, refresh]);
  const reopen = async () => {
    if (!window.confirm("Сохранить актуальный локальный текст на устройстве и переоткрыть документ? После открытия можно сравнить и восстановить черновик; сервер автоматически не перезаписывается.")) return;
    setBusy(true);try { await persist();window.location.reload(); } catch (cause) { setBusy(false);setError(cause instanceof Error ? cause.message : "Не удалось сохранить локальную страховку; документ остаётся открытым"); }
  };
  return <section className="recovery-notice" aria-label="Сравнение при ошибке сохранения"><strong>Сервер и локальный текст</strong><p>Локальное состояние не является сохранённой версией. При конфликте новая серверная версия не перезаписывается автоматически.</p>
    <div className="history-block-actions"><button type="button" onClick={() => setRefresh(old => old + 1)}>Обновить сравнение</button><button type="button" disabled={busy} onClick={() => void reopen()}>Переоткрыть с локальным черновиком</button><button type="button" onClick={onClose}>Закрыть сравнение</button></div>
    {error && <p role="alert">{error}</p>}{comparison ? <><small>Сервер r{comparison.revision} → локальный снимок на момент сравнения</small><DocumentComparison before={comparison.before} after={comparison.after}/></> : <p role="status">Загрузка сохранённого состояния…</p>}
  </section>;
}
