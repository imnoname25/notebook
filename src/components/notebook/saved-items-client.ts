"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import type { getSavedItem } from "@/lib/services/saved-item-service";

type Item = Awaited<ReturnType<typeof getSavedItem>>;
export type SavedItem = Omit<Item, "createdAt" | "updatedAt" | "archivedAt" | "convertedAt"> & {
  createdAt: string; updatedAt: string; archivedAt: string | null; convertedAt: string | null;
};
type Result = { items: SavedItem[]; nextCursor: string | null };
type Page = { key: string; data?: Result; error?: string };

export const savedEndpoint = "/api/saved-items";
export const savedItemEndpoint = (id: string) => `${savedEndpoint}/${encodeURIComponent(id)}`;
export const savedError = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить запрос";

export function savedSource(item: SavedItem) {
  if (!item.url) return "";
  try { return new URL(item.url).hostname; } catch { return ""; }
}

export function savedTitle(item: SavedItem) {
  return item.displayTitle;
}

export function savedRequestKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function useSavedItems(query: string, version: number) {
  const key = `${version}:${query}`;
  const [page, setPage] = useState<Page | null>(null);
  const [moreError, setMoreError] = useState<{ key: string; message: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const more = useRef<AbortController | null>(null);
  const current = page?.key === key ? page : null;
  const hasQueued = current?.data?.items.slice(0, 25).some(item => item.metadataStatus === "queued");

  useEffect(() => {
    const controller = new AbortController();
    void api<Result>(`${savedEndpoint}?${query}`, { signal: controller.signal })
      .then(data => setPage({ key, data }))
      .catch(error => { if (!controller.signal.aborted) setPage({ key, error: savedError(error) }); });
    return () => { controller.abort(); more.current?.abort(); more.current = null; };
  }, [key, query]);

  useEffect(() => {
    if (!hasQueued) return;
    const controller = new AbortController();
    let busy = false;
    const timer = window.setInterval(async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const data = await api<Result>(`${savedEndpoint}?${query}`, { signal: controller.signal });
        const updated = new Map(data.items.map(item => [item.id, item]));
        setPage(previous => previous?.key === key && previous.data
          ? { key, data: { ...previous.data, items: previous.data.items.map(item => updated.get(item.id) ?? item) } }
          : previous);
      } catch { /* The current list remains available while polling. */ }
      finally { busy = false; }
    }, 5_000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [hasQueued, key, query]);

  async function loadMore() {
    if (!current?.data?.nextCursor || more.current) return;
    const controller = new AbortController();
    more.current = controller;
    setMoreError(null);
    setLoadingMore(key);
    const params = new URLSearchParams(query);
    params.set("cursor", current.data.nextCursor);
    try {
      const data = await api<Result>(`${savedEndpoint}?${params}`, { signal: controller.signal });
      setPage(previous => {
        if (previous?.key !== key || !previous.data) return previous;
        const ids = new Set(previous.data.items.map(item => item.id));
        return { key, data: { items: [...previous.data.items, ...data.items.filter(item => !ids.has(item.id))], nextCursor: data.nextCursor } };
      });
    } catch (error) {
      if (!controller.signal.aborted) setMoreError({ key, message: savedError(error) });
    } finally {
      if (more.current === controller) { more.current = null; setLoadingMore(null); }
    }
  }

  return { data: current?.data, error: current?.error, loadMore, loadingMore: loadingMore === key, moreError: moreError?.key === key ? moreError.message : null };
}

export function useSavedItem(id: string | null, version: number) {
  const key = `${version}:${id}`;
  const [response, setResponse] = useState<{ key: string; item?: SavedItem; error?: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    const endpoint = savedItemEndpoint(id);
    const controller = new AbortController();
    let timer: number | undefined;
    async function load(polling = false) {
      if (polling && document.hidden) { timer = window.setTimeout(() => void load(true), 5_000); return; }
      try {
        const { item } = await api<{ item: SavedItem }>(endpoint, { signal: controller.signal });
        setResponse({ key, item });
        if (item.metadataStatus === "queued") timer = window.setTimeout(() => void load(true), 5_000);
      } catch (error) {
        if (!controller.signal.aborted && !polling) setResponse({ key, error: savedError(error) });
        if (!controller.signal.aborted && polling) timer = window.setTimeout(() => void load(true), 10_000);
      }
    }
    void load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [id, key]);
  return response?.key === key ? response : null;
}
