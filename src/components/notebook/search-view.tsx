"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Search, SlidersHorizontal } from "lucide-react";
import { useLiveSearch } from "./use-live-search";
import { SearchResultContent } from "./search-result-content";
import type { Notebook } from "./types";
import type { SearchResult } from "@/lib/services/search-service";
import { EMPTY_SEARCH, type WorkspaceSearch } from "@/lib/workspace-search";

export function SearchView({ value, onChange, onSelect, onBack, notebooks, focusRequest }: {
  value: WorkspaceSearch; onChange(value: WorkspaceSearch): void; onSelect(result: SearchResult): void;
  onBack(): void; notebooks: Notebook[]; focusRequest: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { results, nextOffset, loading, error, ready, current, more, retry } = useLiveSearch(value);
  const [selected, setSelected] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sections = notebooks.filter(book => !value.notebookId || book.id === value.notebookId).flatMap(book => book.sections.map(section => ({ ...section, notebookTitle: book.title })));
  const filterCount = Object.entries(value).filter(([name, v]) => name !== "q" && v && !(name === "group" && v === "all")).length;
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [focusRequest]);
  function change(next: WorkspaceSearch) { setSelected(0);onChange(next); }
  function keys(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.closest("select, details, [data-search-filters]")) return;
    if (event.key === "Escape") { event.preventDefault(); target.blur(); return; }
    if (!results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); const index = (Math.min(selected, results.length - 1) + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      setSelected(index); list.current?.querySelector<HTMLElement>(`[data-result-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && (target === input.current || target.closest("[data-result-index]"))) {
      event.preventDefault(); onSelect(results[Math.min(selected, results.length - 1)]!);
    }
  }
  return <section className="notebook-search-view flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Глобальный поиск" onKeyDown={keys}>
    <header className="search-view-heading flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <button type="button" className="search-action" aria-label="Вернуться из поиска" onClick={onBack}><ArrowLeft size={18}/></button>
      <h1 className="min-w-0 flex-1 text-base font-semibold">{value.group === "favorites" ? "Избранное" : value.group === "recent" ? "Недавние" : "Поиск по Notebook"}</h1>
      <button type="button" className="search-action gap-1" aria-label="Фильтры поиска" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(old => !old)}><SlidersHorizontal size={17}/>{filterCount > 0 && <span className="text-xs">{filterCount}</span>}</button>
    </header>
    <div className="search-view-query flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
      <Search size={18} className="shrink-0 text-muted-foreground"/>
      <input ref={input} type="search" aria-label="Поиск по заголовкам и содержимому" aria-controls="workspace-search-results" aria-describedby="search-results-status" value={value.q} maxLength={300} placeholder="Название, текст или #тег" className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={event => change({ ...value, q: event.target.value })}/>
    </div>
    {filtersOpen && <div data-search-filters className="search-filters grid shrink-0 grid-cols-2 gap-2 border-b border-border p-3 text-xs sm:grid-cols-3">
      <label>Блокнот<select aria-label="Блокнот" value={value.notebookId} onChange={event => change({ ...value, notebookId: event.target.value, sectionId: "" })}><option value="">Все блокноты</option>{notebooks.map(book => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>
      <label>Раздел<select aria-label="Раздел" value={value.sectionId} onChange={event => change({ ...value, sectionId: event.target.value })}><option value="">Все разделы</option>{sections.map(section => <option key={section.id} value={section.id}>{value.notebookId ? section.title : `${section.notebookTitle} / ${section.title}`}</option>)}</select></label>
      <label>Тег<input aria-label="Тег" value={value.tag} maxLength={80} placeholder="#тег" onChange={event => change({ ...value, tag: event.target.value })}/></label>
      <label>Изменено с<input type="date" aria-label="Изменено с" value={value.dateFrom} onChange={event => change({ ...value, dateFrom: event.target.value })}/></label>
      <label>Изменено по<input type="date" aria-label="Изменено по" value={value.dateTo} onChange={event => change({ ...value, dateTo: event.target.value })}/></label>
      <button type="button" className="min-h-11 self-end rounded px-2 text-left hover:bg-accent" onClick={() => change({ ...EMPTY_SEARCH, q: value.q })}>Сбросить фильтры</button>
    </div>}
    <div id="search-results-status" role="status" aria-live="polite" className="shrink-0 px-4 py-2 text-xs text-muted-foreground">{!ready ? "Введите хотя бы два символа или выберите фильтр" : loading || !current && !error ? "Поиск…" : error || `Показано: ${results.length}${nextOffset !== null ? "+" : results.length >= 275 ? ". Уточните запрос для остальных результатов" : ""}`}</div>
    <div ref={list} id="workspace-search-results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4" aria-label="Результаты поиска" aria-busy={loading || ready && !current && !error}>
      {ready && current && !results.length && !loading && !error && <p className="px-3 py-10 text-sm text-muted-foreground">Ничего не найдено. Измените запрос или фильтры.</p>}
      {error && <button type="button" className="search-action px-3" onClick={retry}>Повторить поиск</button>}
      {results.map((result, index) => <button type="button" key={`${result.type}:${result.id}`} data-result-index={index} aria-current={selected === index ? "true" : undefined} onFocus={() => setSelected(index)} onClick={() => onSelect(result)} className="search-result flex w-full min-w-0 gap-3 rounded px-3 py-3 text-left text-sm"><SearchResultContent result={result} date/></button>)}
      {current && nextOffset !== null && <button type="button" className="search-action mx-auto px-4 text-sm" disabled={loading} onClick={() => void more()}>Показать ещё</button>}
    </div>
  </section>;
}