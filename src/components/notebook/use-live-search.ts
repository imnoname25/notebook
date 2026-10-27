"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { canSearch, searchParams, type WorkspaceSearch } from "@/lib/workspace-search";
import type { SearchResult } from "@/lib/services/search-service";

type Response = { results: SearchResult[]; nextOffset: number | null };
/** One request lifecycle for quick and advanced search; both use /api/search. */
export function useLiveSearch(value: WorkspaceSearch, active = true) {
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ key: string; response: Response; error: string; loading: boolean }>({ key: "", response: { results: [], nextOffset: null }, error: "", loading: false });
  const [attempt, setAttempt] = useState(0);
  const key = searchParams(value).toString();
  const ready = active && canSearch(value);
  const current = state.key === key;
  useEffect(() => {
    const id = ++request.current;
    const abort = new AbortController();controller.current = abort;
    if (!ready) return () => abort.abort();
    const timer = setTimeout(() => {
      setState({ key, response: { results: [], nextOffset: null }, error: "", loading: true });
      void api<Response>(`/api/search?${key}`, { signal: abort.signal }).then(response => {
        if (id === request.current && !abort.signal.aborted) setState({ key, response, error: "", loading: false });
      }).catch(error => {
        if (id === request.current && !abort.signal.aborted) setState({ key, response: { results: [], nextOffset: null }, error: error instanceof Error ? error.message : "Не удалось выполнить поиск", loading: false });
      });
    }, 200);
    return () => { clearTimeout(timer);abort.abort(); };
  }, [key, ready, attempt]);
  async function more() {
    if (!ready || !current || state.loading || state.response.nextOffset === null) return;
    const id = request.current;const signal = controller.current?.signal;
    setState(old => ({ ...old, loading: true, error: "" }));
    try {
      const response = await api<Response>(`/api/search?${key}&offset=${state.response.nextOffset}`, { signal });
      if (id !== request.current || signal?.aborted) return;
      setState(old => ({ key, loading: false, error: "", response: { results: [...old.response.results, ...response.results.filter(item => !old.response.results.some(previous => previous.id === item.id && previous.type === item.type))], nextOffset: response.nextOffset } }));
    } catch (error) { if (id === request.current && !signal?.aborted) setState(old => ({ ...old, loading: false, error: error instanceof Error ? error.message : "Не удалось загрузить результаты" })); }
  }
  return { ready, current, results: ready && current ? state.response.results : [], nextOffset: ready && current ? state.response.nextOffset : null, loading: ready && (!current || state.loading), error: ready && current ? state.error : "", more, retry: () => setAttempt(value => value + 1) };
}
