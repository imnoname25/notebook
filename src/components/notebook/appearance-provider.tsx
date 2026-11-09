"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { fontFamilies } from "@/app/fonts";
import { api, jsonOptions } from "@/lib/client-api";
import { DEFAULT_APPEARANCE, normalizeAppearance, THEME_FONTS, type AppearancePreferences } from "@/lib/appearance-preferences";
import { THEMES, type NotebookTheme } from "@/lib/themes";

type AppearanceContextValue = {
  preferences: AppearancePreferences;
  update(patch: Partial<AppearancePreferences>): void;
  saving: boolean;
  loaded: boolean;
  error: string;
  retry(): void;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);
const legacySans = '"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif';
const legacyMono = 'ui-monospace, SFMono-Regular, Consolas, monospace';
const cacheKey = (userId: string) => `notebook:appearance:${userId}`;

export function AppearanceProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const nextTheme = useTheme();
  const [preferences, setPreferences] = useState(() => {
    try { return normalizeAppearance(JSON.parse(localStorage.getItem(cacheKey(userId)) ?? "{}")); }
    catch { return DEFAULT_APPEARANCE; }
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(preferences);
  const theme = useRef(nextTheme.theme);
  const alive = useRef(true);
  const pending = useRef(0);
  const generation = useRef(0);
  const failedWrite = useRef(false);
  const queue = useRef(Promise.resolve());
  const writes = useRef(new Set<AbortController>());
  const read = useRef<AbortController | null>(null);
  const themeSetter = useRef(nextTheme.setTheme);
  useLayoutEffect(() => { themeSetter.current = nextTheme.setTheme; }, [nextTheme.setTheme]);
  const setTheme = useCallback((value: string) => themeSetter.current(value), []);

  useEffect(() => { theme.current = nextTheme.theme; }, [nextTheme.theme]);
  const remember = useCallback((value: AppearancePreferences) => {
    try { localStorage.setItem(cacheKey(userId), JSON.stringify(value)); } catch { /* Server remains authoritative when storage is unavailable. */ }
  }, [userId]);

  const update = useCallback((patch: Partial<AppearancePreferences>) => {
    const value = normalizeAppearance({ ...current.current, ...patch });
    current.current = value;
    generation.current++;
    setPreferences(value);
    if (patch.theme) setTheme(value.theme);
    remember(value);
    setError("");
    setSaving(true);
    pending.current++;
    queue.current = queue.current.then(async () => {
      if (!alive.current) return;
      const controller = new AbortController();
      writes.current.add(controller);
      try {
        await api("/api/account/preferences", { ...jsonOptions("PATCH", { appearance: failedWrite.current ? current.current : patch }), signal: controller.signal });
        failedWrite.current = false;
        if (alive.current) { setLoaded(true); setError(""); }
      } catch (cause) {
        if (alive.current && !controller.signal.aborted) {
          failedWrite.current = true;
          setError(cause instanceof Error ? cause.message : "Не удалось сохранить оформление");
        }
      } finally {
        writes.current.delete(controller);
        pending.current--;
        if (alive.current && pending.current === 0) setSaving(false);
      }
    });
  }, [remember, setTheme]);

  const refresh = useCallback(async () => {
    if (pending.current || failedWrite.current) return;
    read.current?.abort();
    const controller = new AbortController();read.current = controller;
    const started = generation.current;
    try {
      const { settings } = await api<{ settings: { appearance: unknown; appearanceConfigured: boolean } }>("/api/account/preferences", { signal: controller.signal });
      if (!alive.current || controller.signal.aborted || generation.current !== started) return;
      const value = normalizeAppearance(settings.appearance);
      if (!settings.appearanceConfigured) {
        let previousUser: string | null = null;
        try { previousUser = localStorage.getItem("notebook:appearance:last-user"); } catch { /* Optional browser compatibility state. */ }
        if (!previousUser || previousUser === userId) value.theme = THEMES.find(candidate => candidate === theme.current) ?? "system";
      }
      try { localStorage.setItem("notebook:appearance:last-user", userId); } catch { /* Optional compatibility marker. */ }
      current.current = value;
      setPreferences(value);
      setTheme(value.theme);
      remember(value);
      setError("");
      setLoaded(true);
      if (!settings.appearanceConfigured) update({ theme: value.theme });
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить оформление");
    }
  }, [remember, setTheme, update, userId]);

  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => { if (alive.current) void refresh(); });
    const activeWrites = writes.current;
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      read.current?.abort();
      for (const controller of activeWrites) controller.abort();
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const resolved = nextTheme.resolvedTheme ?? preferences.theme;
    const defaults = THEME_FONTS[resolved];
    const ui = preferences.uiFont === "theme" ? defaults?.ui : preferences.uiFont;
    const editor = preferences.editorFont === "theme" ? defaults?.editor : preferences.editorFont;
    const uiFamily = ui ? fontFamilies[ui] : legacySans;
    const editorFamily = editor ? fontFamilies[editor] : legacySans;
    const titleFamily = preferences.editorFont === "theme" && resolved === "studio-atelier" ? 'Georgia, Cambria, "Times New Roman", serif' : editorFamily;
    const styles: Record<string, string> = {
      "--notebook-ui-font": uiFamily,
      "--notebook-editor-font": editorFamily,
      "--notebook-editor-size": `${preferences.editorSize}px`,
      "--notebook-editor-leading": String({ compact: 1.45, normal: 1.7, relaxed: 1.95 }[preferences.lineHeight]),
      "--studio-ui-font": uiFamily,
      "--studio-document-font": titleFamily,
      "--studio-font-body": `${preferences.editorSize}px`,
      "--studio-code-font": defaults ? fontFamilies["jetbrains-mono"] : legacyMono,
    };
    root.dataset.appearance = "true";
    for (const [name, value] of Object.entries(styles)) root.style.setProperty(name, value);
    return () => {
      delete root.dataset.appearance;
      for (const name of Object.keys(styles)) root.style.removeProperty(name);
    };
  }, [preferences, nextTheme.resolvedTheme]);

  return <AppearanceContext.Provider value={{ preferences, update, saving, loaded, error, retry: () => { if (failedWrite.current) update(current.current); else void refresh(); } }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("Appearance settings require an authenticated workspace");
  return value;
}
export function useNotebookTheme() {
  const theme = useTheme();
  const appearance = useContext(AppearanceContext);
  return { ...theme, setTheme: (value: string) => {
    const safe = THEMES.find(candidate => candidate === value) ?? "system";
    if (appearance) appearance.update({ theme: safe as NotebookTheme });
    else theme.setTheme(safe);
  } };
}
