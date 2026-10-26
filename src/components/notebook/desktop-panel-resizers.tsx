"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { DEFAULT_PANEL_PREFERENCES, DESKTOP_PANELS_BREAKPOINT, PANEL_LIMITS, RESET_DESKTOP_PANELS, panelLayoutKey, panelMaximum, parsePanelPreferences, resizePanel, resolvePanelWidths, serializePanelPreferences, type Panel, type PanelPreferences, type PanelWidths } from "@/lib/desktop-panel-layout";

type Drag = { panel: Panel; pointerId: number; element: HTMLDivElement; startX: number; start: PanelWidths; preferences: PanelPreferences; x: number; moved: boolean };
export function DesktopPanelResizers({ userId, enabled, onError }: {
  userId: string; enabled: boolean; onError(error: unknown): void;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const preferences = useRef<PanelPreferences>({ ...DEFAULT_PANEL_PREFERENCES });
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const width = useRef(0);
  const [layout, setLayout] = useState({ width: 0, widths: resolvePanelWidths(DEFAULT_PANEL_PREFERENCES, 1200) });
  const [active, setActive] = useState<Panel | null>(null);
  const callbacks = useRef({ onError });
  useLayoutEffect(() => { callbacks.current = { onError }; });

  const apply = useCallback(() => {
    const widths = resolvePanelWidths(preferences.current, width.current);
    rootRef.current?.style.setProperty("--workspace-sidebar-width", `${widths.sidebar}px`);
    rootRef.current?.style.setProperty("--workspace-list-width", `${widths.list}px`);
    setLayout(old => old.width === width.current && old.widths.sidebar === widths.sidebar && old.widths.list === widths.list ? old : { width: width.current, widths });
  }, []);
  const persist = useCallback(() => {
    try { localStorage.setItem(panelLayoutKey(userId), serializePanelPreferences(preferences.current)); }
    catch { callbacks.current.onError(new Error("Не удалось сохранить размеры панелей в этом браузере")); }
  }, [userId]);
  const preview = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    preferences.current = resizePanel(current.panel, current.start[current.panel] + current.x - current.startX, current.start, width.current);
    apply();
  }, [apply]);
  const finish = useCallback((commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    cancelAnimationFrame(frame.current);
    if (commit && current.moved) preview();
    else preferences.current = current.preferences;
    drag.current = null;
    rootRef.current?.removeAttribute("data-panel-resizing");
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    setActive(null);
    apply();
    if (commit && current.moved) persist();
  }, [apply, persist, preview]);
  // Mount-time storage is read before paint; neither SSR nor the hydration render reads it.
  useLayoutEffect(() => {
    try { preferences.current = parsePanelPreferences(localStorage.getItem(panelLayoutKey(userId))); } catch { preferences.current = { ...DEFAULT_PANEL_PREFERENCES }; }
    const root = anchorRef.current?.closest<HTMLDivElement>(".notebook-app-shell");
    if (!root) return;
    rootRef.current = root;
    const measure = () => { width.current = root.clientWidth; apply(); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    const reset = () => { finish(false); preferences.current = { ...DEFAULT_PANEL_PREFERENCES }; apply(); persist(); };
    const blur = () => finish(false);
    window.addEventListener(RESET_DESKTOP_PANELS, reset);
    window.addEventListener("blur", blur);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame.current);
      window.removeEventListener(RESET_DESKTOP_PANELS, reset); window.removeEventListener("blur", blur);
      rootRef.current = null;
      root.removeAttribute("data-panel-resizing");
      root.style.removeProperty("--workspace-sidebar-width"); root.style.removeProperty("--workspace-list-width");
    };
  }, [apply, finish, persist, userId]);
  useEffect(() => { if (!enabled || layout.width < DESKTOP_PANELS_BREAKPOINT) finish(false); }, [enabled, finish, layout.width]);

  const begin = (event: PointerEvent<HTMLDivElement>, panel: Panel) => {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { panel, pointerId: event.pointerId, element: event.currentTarget, startX: event.clientX, x: event.clientX, start: resolvePanelWidths(preferences.current, width.current), preferences: { ...preferences.current }, moved: false };
    rootRef.current?.setAttribute("data-panel-resizing", "true"); setActive(panel);
  };
  const resetPanel = (panel: Panel) => { preferences.current = { ...preferences.current, [panel]: null }; apply(); persist(); };
  const visible = enabled && layout.width >= DESKTOP_PANELS_BREAKPOINT;
  return <>
    <span ref={anchorRef} hidden aria-hidden="true"/>
    {visible && <>
    <span id="workspace-resize-help" className="sr-only">Стрелки меняют ширину на 8 пикселей, Shift — на 32. Home или двойной щелчок возвращает стандартную ширину.</span>
    {(["sidebar", "list"] as const).map(panel => <div key={panel} role="separator" tabIndex={0} aria-orientation="vertical" aria-label={panel === "sidebar" ? "Ширина панели блокнотов" : "Ширина списка документов"}
      aria-controls={panel === "sidebar" ? "workspace-sidebar-panel" : "workspace-page-list-panel"} aria-describedby="workspace-resize-help" aria-valuemin={PANEL_LIMITS[panel].min} aria-valuemax={panelMaximum(panel, layout.widths, layout.width)} aria-valuenow={layout.widths[panel]} aria-valuetext={`${layout.widths[panel]} пикселей`}
      className="workspace-panel-resizer notebook-no-print" data-panel={panel} data-active={active === panel} onPointerDown={event => begin(event, panel)}
      onPointerMove={event => { const current = drag.current; if (!current || event.pointerId !== current.pointerId) return; current.x = event.clientX; current.moved ||= Math.abs(current.x - current.startX) >= 2; if (!current.moved) return; cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(preview); }}
      onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) { drag.current.x = event.clientX; finish(true); } }} onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) finish(false); }} onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) finish(false); }} onDoubleClick={() => resetPanel(panel)}
      onKeyDown={event => {
        if (drag.current) { if (event.key === "Escape") { event.preventDefault(); finish(false); } return; }
        if (event.key === "Home") { event.preventDefault(); resetPanel(panel); }
        else if (["ArrowLeft", "ArrowRight", "End"].includes(event.key)) {
          event.preventDefault(); const actual = resolvePanelWidths(preferences.current, width.current);
          const target = event.key === "End" ? panelMaximum(panel, actual, width.current) : actual[panel] + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 32 : 8);
          preferences.current = resizePanel(panel, target, actual, width.current); apply();
        }
      }} onKeyUp={event => { if (["ArrowLeft", "ArrowRight", "End"].includes(event.key)) persist(); }}/>) }
    </>}
  </>;
}
