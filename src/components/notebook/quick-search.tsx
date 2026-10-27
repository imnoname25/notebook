"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { EMPTY_SEARCH } from "@/lib/workspace-search";
import type { SearchResult } from "@/lib/services/search-service";
import { SearchResultContent } from "./search-result-content";
import { useLiveSearch } from "./use-live-search";

export function QuickSearch({ open, focusRequest, onOpenChange, onSelect, onAdvanced }: {
  open: boolean; focusRequest: number; onOpenChange(value: boolean): void;
  onSelect(result: SearchResult, query: string): Promise<boolean>; onAdvanced(query: string): void;
}) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<{ results: SearchResult[]; loading: boolean; error: string }>({ results: [], loading: true, error: "" });
  const [recentAttempt, setRecentAttempt] = useState(0);
  const [selected, setSelected] = useState(0);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number; width: number; mobile: boolean; inlineInput: boolean } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const desktopInput = useRef<HTMLInputElement>(null);
  const layerInput = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  // Quick search always starts with empty filters; advanced filters remain separate.
  const live = useLiveSearch({ ...EMPTY_SEARCH, q: query }, open);
  const empty = !query.trim();
  const results = (empty ? recent.results : live.results).slice(0, 8);
  const loading = empty ? recent.loading : live.loading;
  const error = openError || (empty ? recent.error : live.error);
  const active = Math.min(selected, Math.max(0, results.length - 1));
  useEffect(() => {
    if (!open || !empty) return;
    const abort = new AbortController();
    void api<{ recent: SearchResult[] }>("/api/navigation/quick", { signal: abort.signal }).then(data => {
      if (!abort.signal.aborted) setRecent({ results: data.recent, loading: false, error: "" });
    }).catch(error => { if (!abort.signal.aborted) setRecent({ results: [], loading: false, error: error instanceof Error ? error.message : "Не удалось загрузить недавние" }); });
    return () => abort.abort();
  }, [open, empty, recentAttempt]);
  useLayoutEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const measure = () => {
      const rect = anchor.current?.getBoundingClientRect();
      const studio = document.documentElement.matches(".studio-graphite, .studio-atelier");
      const mobile = window.matchMedia(studio ? "(max-width: 1199px)" : "(max-width: 767px)").matches;
      const width = Math.min(520, window.innerWidth - 24);
      const visible = Boolean(rect?.width && rect.height);
      setPosition({ mobile, inlineInput: mobile || !visible, width, top: visible && !mobile ? rect!.bottom + 6 : 12, left: visible && !mobile ? Math.max(12, Math.min(rect!.left, window.innerWidth - width - 12)) : Math.max(12, (window.innerWidth - width) / 2) });
    };
    measure();window.addEventListener("resize", measure);window.visualViewport?.addEventListener("resize", measure);
    return () => { window.removeEventListener("resize", measure);window.visualViewport?.removeEventListener("resize", measure); };
  }, [open]);
  useEffect(() => {
    if (!open || !position) return;
    (position.inlineInput ? layerInput.current : desktopInput.current)?.focus({ preventScroll: true });
  }, [open, focusRequest, position]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open, onOpenChange]);
  function close(restore = false) {
    onOpenChange(false);
    if (restore) {
      desktopInput.current?.blur();
      if (previousFocus.current && previousFocus.current !== desktopInput.current) previousFocus.current.focus({ preventScroll: true });
    }
  }
  function change(value: string) { setQuery(value);setSelected(0);setOpenError("");onOpenChange(true); }
  async function select(result: SearchResult) {
    if (opening) return;
    setOpening(true);setOpenError("");
    try { if (await onSelect(result, query)) close();else setOpenError("Не удалось открыть результат. Текущий документ остаётся открытым."); }
    catch { setOpenError("Не удалось открыть результат. Повторите попытку."); }
    finally { setOpening(false); }
  }
  function keys(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault();event.stopPropagation();close(true);return; }
    if (!open || !results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();event.stopPropagation();const next = (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      setSelected(next);panel.current?.querySelector<HTMLElement>(`[data-quick-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && (event.target instanceof HTMLInputElement || (event.target as HTMLElement).closest("[data-quick-index]"))) { event.preventDefault();event.stopPropagation();void select(results[active]!); }
  }
  const inputProps = { role: "combobox" as const, "aria-label": "Быстрый поиск", "aria-expanded": open, "aria-controls": "quick-search-results", "aria-autocomplete": "list" as const, "aria-activedescendant": open && results.length ? `quick-result-${active}` : undefined, value: query, maxLength: 300, placeholder: "Поиск…", onChange: (event: React.ChangeEvent<HTMLInputElement>) => change(event.target.value), onKeyDown: keys };
  return <>
    <div ref={anchor} className="notebook-global-search quick-search-field flex min-w-0 items-center gap-2" data-open={open}>
      <Search size={15} aria-hidden="true"/><input ref={desktopInput} type="search" {...inputProps} onFocus={() => onOpenChange(true)} className="min-w-0 flex-1 bg-transparent outline-none"/><kbd aria-hidden="true" className="shrink-0 text-[10px]">Ctrl K</kbd>
    </div>
    {open && createPortal(<div ref={panel} className="quick-search-panel" data-mobile={position?.mobile ?? false} role="region" aria-label="Быстрый поиск документов" onKeyDown={keys} style={{ visibility: position ? "visible" : "hidden", ...(position?.mobile ? {} : { top: position?.top, left: position?.left, width: position?.width, maxHeight: `min(480px, calc(100dvh - ${(position?.top ?? 0) + 12}px))` }) }}>
      {position?.inlineInput && <div className="quick-search-layer-heading flex shrink-0 items-center gap-2 border-b border-border p-2"><Search size={18}/><input ref={layerInput} type="search" {...inputProps} className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base outline-none"/><button type="button" className="search-action" aria-label="Закрыть быстрый поиск" onClick={() => close(true)}><X size={19}/></button></div>}
      <p role="status" aria-live="polite" className="shrink-0 px-3 py-2 text-xs text-muted-foreground">{error || (loading ? "Поиск…" : empty ? "Недавние документы" : query.trim().length < 2 ? "Введите хотя бы два символа" : results.length ? "Результаты поиска" : "Ничего не найдено")}</p>
      {error && <button type="button" className="search-action shrink-0 px-3 text-sm" onClick={() => { setOpenError("");if (empty) setRecentAttempt(value => value + 1);else live.retry(); }}>Повторить поиск</button>}
      <div id="quick-search-results" role="listbox" aria-label="Быстрые результаты" aria-busy={loading || opening} className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
        {results.map((result, index) => <button type="button" role="option" id={`quick-result-${index}`} key={`${result.type}:${result.id}`} data-quick-index={index} aria-selected={active === index} disabled={opening} tabIndex={0} className="search-result flex w-full gap-2 rounded px-2 py-2 text-left text-sm" onFocus={() => setSelected(index)} onClick={() => void select(result)}><SearchResultContent result={result}/></button>)}
      </div>
      <button type="button" className="quick-search-advanced shrink-0 border-t border-border px-3 py-2.5 text-left text-sm hover:bg-accent" onClick={() => { close();onAdvanced(query); }}>{live.nextOffset !== null || live.results.length > 8 ? "Все результаты" : "Расширенный поиск"}</button>
    </div>, document.body)}
  </>;
}
