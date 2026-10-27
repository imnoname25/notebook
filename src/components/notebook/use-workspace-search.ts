"use client";

import { useCallback, useRef, useState } from "react";
import { EMPTY_SEARCH, searchFromUrl, searchHref, type WorkspaceSearch } from "@/lib/workspace-search";

export type WorkspaceScreen = "workspace" | "trash" | "stickers" | "today" | "search";
export function useWorkspaceSearch({ leave, setScreen }: {
  leave(operation: () => void): Promise<boolean>;
  setScreen(value: WorkspaceScreen): void;
}) {
  const [state, setState] = useState<WorkspaceSearch>({ ...EMPTY_SEARCH });
  const [focusRequest, setFocusRequest] = useState(0);
  const entered = useRef(false);
  const open = useCallback((patch?: Partial<WorkspaceSearch>) => leave(() => {
    const current = searchFromUrl(window.location.href);
    const next = patch ? { ...EMPTY_SEARCH, ...patch } : current ?? state;
    if (!current) { window.history.pushState(null, "", searchHref(next)); entered.current = true; }
    else window.history.replaceState(null, "", searchHref(next));
    setState(next); setScreen("search"); setFocusRequest(value => value + 1);
  }), [leave, setScreen, state]);
  const change = useCallback((next: WorkspaceSearch) => {
    setState(next); window.history.replaceState(null, "", searchHref(next));
  }, []);
  const restore = useCallback(() => {
    const next = searchFromUrl(window.location.href);
    if (!next) return false;
    setState(next); setScreen("search"); return true;
  }, [setScreen]);
  const back = useCallback(() => {
    if (entered.current) window.history.back();
    else { window.history.replaceState(null, "", "/app"); setScreen("workspace"); }
  }, [setScreen]);
  return { state, focusRequest, open, change, restore, back };
}
