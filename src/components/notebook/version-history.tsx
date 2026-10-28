"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { z } from "zod";
import { Clock3, X } from "lucide-react";
import { api } from "@/lib/client-api";
import type { DocumentState } from "@/lib/document-state";
import type { BlockRecovery } from "@/lib/block-recovery";
import type { EditorSaveController, PageDocument } from "./types";
import { DocumentComparison } from "./document-comparison";

const metaSchema = z.object({ id: z.string(), title: z.string(), reason: z.string(), createdAt: z.string() });
const versionSchema = metaSchema.extend({ pageId: z.string(), content: z.array(z.unknown()) });
const savedSchema = z.object({ id: z.string(), title: z.string(), content: z.array(z.unknown()), revision: z.number().int() });
type VersionMeta = z.infer<typeof metaSchema>;
type Version = z.infer<typeof versionSchema>;
type Saved = z.infer<typeof savedSchema>;
type Props = { page: PageDocument | null; controller?: EditorSaveController; open: boolean; onOpenChange(open: boolean): void; onRestore(versionId: string, expectedRevision: number): Promise<void> };
const reason = (value: string) => ({ interval: "Autosave snapshot", manual: "Защитный / ручной снимок", before_restore: "Перед восстановлением", restored: "Результат восстановления" })[value as keyof { interval: string; manual: string; before_restore: string; restored: string }] ?? value;
const day = (value: string) => new Intl.DateTimeFormat("ru", { dateStyle: "long" }).format(new Date(value));
export function VersionHistory(props: Props) {
  if (!props.page) return null;
  return <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/25"/><Dialog.Content aria-describedby={undefined} className="history-workspace fixed inset-0 z-50 bg-card text-foreground">
    <header className="history-header"><Clock3 size={18}/><Dialog.Title>История · {props.page.title}</Dialog.Title><Dialog.Close aria-label="Закрыть историю"><X size={18}/></Dialog.Close></header>
    <HistorySession key={props.page.id} {...props} page={props.page}/>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
function HistorySession(props: Props & { page: PageDocument }) {
  const latest = useRef(props);useLayoutEffect(() => { latest.current = props; });
  const [versions, setVersions] = useState<VersionMeta[]>([]);const [cursor, setCursor] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);const [draft, setDraft] = useState<DocumentState | null>(null);
  const [left, setLeft] = useState("");const [right, setRight] = useState("saved");
  const [pair, setPair] = useState<{ left: string; right: string; before: DocumentState; after: DocumentState } | null>(null);
  const [loading, setLoading] = useState(true);const [busy, setBusy] = useState(false);const [error, setError] = useState("");const [refresh, setRefresh] = useState(0);
  const cache = useRef(new Map<string, Version>());const pageId = props.page.id;
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([api<unknown>(`/api/pages/${pageId}/versions?limit=25`, { signal: controller.signal }), api<unknown>(`/api/pages/${pageId}`, { signal: controller.signal })]).then(([history, current]) => {
      if (controller.signal.aborted) return;
      const result = z.object({ versions: z.array(metaSchema), nextCursor: z.string().nullable() }).parse(history);const document = z.object({ page: savedSchema }).parse(current).page;
      setVersions(result.versions);setCursor(result.nextCursor);setSaved(document);
      const editor = latest.current.controller;setDraft(editor?.isDirty() ? editor.getDraft?.() ?? null : null);
      setLeft(old => old || result.versions[0]?.id || "saved");setLoading(false);setError("");
    }).catch(cause => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить историю");setLoading(false); } });
    return () => controller.abort();
  }, [pageId, refresh]);
  useEffect(() => {
    if (!saved || !left) return;
    const controller = new AbortController();
    const load = async (id: string): Promise<DocumentState> => {
      if (id === "saved") return saved;if (id === "draft") { if (!draft) throw new Error("Локальный черновик больше недоступен");return draft; }
      if (cache.current.has(id)) return cache.current.get(id)!;
      const result = z.object({ version: versionSchema }).parse(await api<unknown>(`/api/pages/${pageId}/versions/${id}`, { signal: controller.signal })).version;
      if (result.pageId !== pageId) throw new Error("Версия относится к другому документу");
      cache.current.set(id, result);if (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!);return result;
    };
    void Promise.all([load(left), load(right)]).then(([before, after]) => { if (!controller.signal.aborted) { setPair({ left, right, before, after });setError(""); } }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить версию"); });
    return () => controller.abort();
  }, [left, right, saved, draft, pageId]);
  const loadMore = async () => {
    if (!cursor || busy) return;setBusy(true);
    try { const result = z.object({ versions: z.array(metaSchema), nextCursor: z.string().nullable() }).parse(await api<unknown>(`/api/pages/${pageId}/versions?limit=25&cursor=${encodeURIComponent(cursor)}`));setVersions(items => [...new Map([...items, ...result.versions].map(item => [item.id, item])).values()]);setCursor(result.nextCursor); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить версии"); } finally { setBusy(false); }
  };
  const recover = async (request: BlockRecovery) => {
    const editor = latest.current.controller;if (!editor?.recoverBlock || !editor.getDraft) throw new Error("Редактор документа недоступен");
    if (right !== "saved" && right !== "draft") throw new Error("Сравните с текущим документом перед частичным восстановлением");
    await editor.recoverBlock(request);setDraft(editor.getDraft());setRight("draft");
  };
  const restore = async () => {
    if (!saved || ["saved", "draft", ""].includes(left)) return;
    if (!window.confirm("Восстановить выбранную версию целиком? Локальные изменения сначала сохранятся. Текущее состояние останется в истории для отмены восстановления.")) return;
    setBusy(true);setError("");
    try { await latest.current.onRestore(left, saved.revision);latest.current.onOpenChange(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Восстановление не завершено; обновите сравнение перед повторной попыткой"); }
    finally { setBusy(false); }
  };
  const options = <><option value="saved">Текущее сохранённое{saved ? ` · r${saved.revision}` : ""}</option>{draft && <option value="draft">Локальный черновик · не версия</option>}{versions.map(version => <option key={version.id} value={version.id}>{new Date(version.createdAt).toLocaleString("ru")} · {reason(version.reason)}</option>)}</>;
  const index = versions.findIndex(version => version.id === left);
  return <div className="history-body">
    <aside className="history-timeline" aria-label="Временная шкала версий">
      <button type="button" aria-pressed={left === "saved"} onClick={() => setLeft("saved")}>Текущее сохранённое · r{saved?.revision ?? props.page.revision}</button>
      {loading && <p role="status">Загрузка истории…</p>}{!loading && !versions.length && <p>Предыдущих версий пока нет</p>}
      {versions.map((version, index) => { const currentDay = day(version.createdAt);const heading = index === 0 || day(versions[index - 1]!.createdAt) !== currentDay;return <div key={version.id}>{heading && <h3>{currentDay}</h3>}<button type="button" aria-pressed={left === version.id} onClick={() => setLeft(version.id)}><time dateTime={version.createdAt}>{new Intl.DateTimeFormat("ru", { timeStyle: "medium" }).format(new Date(version.createdAt))}</time><span>{reason(version.reason)}</span><small>{version.title}</small></button></div>; })}
      {cursor && <button type="button" disabled={busy} onClick={() => void loadMore()}>Загрузить ещё 25 версий</button>}
    </aside>
    <section className="history-main">
      <div className="history-controls"><label>Исходная версия<select aria-label="Исходная версия" value={left || "saved"} onChange={event => setLeft(event.target.value)}>{options}</select></label><label>Сравнить с<select aria-label="Версия для сравнения" value={right} onChange={event => setRight(event.target.value)}>{options}</select></label><div className="history-neighbours"><button type="button" disabled={index < 0 || index >= versions.length - 1} onClick={() => setLeft(versions[index + 1]!.id)}>← Старше</button><button type="button" disabled={index <= 0} onClick={() => setLeft(versions[index - 1]!.id)}>Новее →</button><button type="button" disabled={busy} onClick={() => setRefresh(old => old + 1)}>Обновить сравнение</button></div></div>
      {draft && <div className="history-draft-banner">Есть локальное состояние редактора. Оно не является сохранённой версией. <button type="button" onClick={() => { setLeft("saved");setRight("draft"); }}>Сравнить черновик с сервером</button></div>}
      {saved && props.page.revision !== saved.revision && <p role="status" className="history-draft-banner">Документ обновился после загрузки сравнения. Обновите сравнение перед восстановлением.</p>}
      {error && <p role="alert" className="history-error">{error}</p>}
      <div className="history-comparison-scroll">{pair && pair.left === left && pair.right === right ? <DocumentComparison before={pair.before} after={pair.after} onRecover={["saved", "draft"].includes(right) ? recover : undefined} disabled={busy}/> : <p role="status">Загрузка выбранных состояний…</p>}</div>
      <footer className="history-footer"><button type="button" disabled={busy || !saved || ["saved", "draft", ""].includes(left)} onClick={() => void restore()}>Восстановить эту версию</button><small>Просмотр не сохраняет документ. Черновики незашифрованы; очистка записей старше 7 дней выполняется при работе приложения. Выход очищает их.</small></footer>
    </section>
  </div>;
}
