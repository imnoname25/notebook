"use client";
import { useEffect, useState } from "react";
import { blockAtPath, type DocumentState } from "@/lib/document-state";
import { textFragment, type DiffRow } from "@/lib/history-diff";
import type { BlockRecovery } from "@/lib/block-recovery";
import { HistoryBlockView } from "./history-block-view";
const labels = { added: "Добавлен", removed: "Удалён", changed: "Изменён", moved: "Перемещён", unchanged: "Без изменений" };
export function DocumentComparison({ before, after, onRecover, disabled = false }: { before: DocumentState; after: DocumentState; onRecover?(request: BlockRecovery): Promise<void>; disabled?: boolean }) {
  const [result, setResult] = useState<{ before: DocumentState; after: DocumentState; rows: DiffRow[] } | null>(null);const [error, setError] = useState("");
  const [hide, setHide] = useState(false);const [side, setSide] = useState("new");const [limit, setLimit] = useState(60);
  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../lib/history-diff.worker.ts", import.meta.url));
      worker.onmessage = event => { if (event.data.error) setError(String(event.data.error));else { setError("");setResult({ before, after, rows: event.data.rows as DiffRow[] });setLimit(60); } };
      worker.onerror = () => setError("Не удалось запустить структурное сравнение. Данные документа не изменены.");
      worker.postMessage({ before: before.content, after: after.content });
    } catch { queueMicrotask(() => setError("Worker сравнения недоступен в этом браузере")); }
    return () => worker?.terminate();
  }, [before, after]);
  const current = result?.before === before && result?.after === after ? result : null;
  if (error) return <p role="alert" className="p-4">{error}</p>;
  if (!current) return <p role="status" className="p-4">Вычисление структурных изменений…</p>;
  const changed = current.rows.filter(row => row.change !== "unchanged").length;
  const rows = hide ? current.rows.filter(row => row.change !== "unchanged") : current.rows;
  const recover = async (request: BlockRecovery) => { try { await onRecover?.(request); } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось восстановить блок"); } };
  return <div className="document-comparison" data-side={side}>
    <div className="history-diff-options"><span>{changed} изменённых блоков</span><label><input type="checkbox" checked={hide} onChange={event => setHide(event.target.checked)}/> Скрыть неизменённые</label><div className="history-mobile-sides"><button type="button" aria-pressed={side === "old"} onClick={() => setSide("old")}>Старая</button><button type="button" aria-pressed={side === "new"} onClick={() => setSide("new")}>Новая</button></div></div>
    <div className="history-comparison-titles"><strong data-history-side="old">{before.title}</strong><strong data-history-side="new">{after.title}</strong></div>
    {rows.slice(0, limit).map(row => {
      const old = row.oldPath ? blockAtPath(before.content, row.oldPath) : null;const next = row.newPath ? blockAtPath(after.content, row.newPath) : null;
      const fragment = old && next ? textFragment(old, next) : null;
      return <section key={row.key} className="history-diff-row" data-change={row.change} data-moved={row.moved} aria-label={labels[row.change]}>
        <div data-history-side="old" className="history-diff-cell" style={{ paddingInlineStart: 12 + Math.min(48, ((row.oldPath?.length ?? 1) - 1) * 12) }}>
          <small className="history-change-label">{labels[row.change]}{row.moved && row.change === "changed" ? " · перемещён" : ""}</small>{old ? <HistoryBlockView block={old}/> : <span className="text-muted-foreground">—</span>}
          {old && onRecover && <div className="history-block-actions">
            {next && typeof next.id === "string" && <button type="button" disabled={disabled} onClick={() => void recover({ historical: old, expected: next, targetId: next.id as string, mode: "replace" })}>Восстановить блок</button>}
            {!next && <button type="button" disabled={disabled} onClick={() => void recover({ historical: old, mode: "append" })}>Восстановить в конец документа</button>}
            <button type="button" disabled={disabled} onClick={() => void recover({ historical: old, mode: "copy" })}>Вставить копию в конец</button>
            {fragment && typeof next?.id === "string" && <button type="button" disabled={disabled} onClick={() => void recover({ historical: old, expected: next, targetId: next.id as string, mode: "fragment" })}>Вернуть изменённый фрагмент</button>}
          </div>}
        </div>
        <div data-history-side="new" className="history-diff-cell" style={{ paddingInlineStart: 12 + Math.min(48, ((row.newPath?.length ?? 1) - 1) * 12) }}>{next ? <HistoryBlockView block={next}/> : <span className="text-muted-foreground">Удалён в новой версии</span>}{fragment && <p className="history-word-diff">{fragment.prefix}<del>{fragment.removed}</del><ins>{fragment.added}</ins>{fragment.suffix}</p>}</div>
      </section>;
    })}
    {rows.length > limit && <button type="button" className="history-load-more" onClick={() => setLimit(old => old + 60)}>Показать ещё 60 блоков · осталось {rows.length - limit}</button>}
    {!rows.length && <p className="p-4 text-muted-foreground">Изменений блоков нет{before.title !== after.title ? "; заголовок изменён" : ""}.</p>}
  </div>;
}
