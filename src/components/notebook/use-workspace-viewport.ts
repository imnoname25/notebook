"use client";

import { useEffect } from "react";

/** Visual viewport shrinks for overlay keyboards; layout width never follows it. */
export function useWorkspaceViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return; // dvh remains the CSS fallback.
    let frame = 0;
    const root = document.documentElement;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Pinch zoom must retain native viewport panning, not relayout the app.
        if (Math.abs(viewport.scale - 1) > 0.01) return;
        root.style.setProperty("--workspace-viewport-height", `${viewport.height}px`);
        root.style.setProperty("--workspace-viewport-top", `${viewport.offsetTop}px`);
        root.dataset.workspaceShort = String(viewport.height < 500);
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !active.isContentEditable) return;
        const selection = window.getSelection();
        if (!selection?.rangeCount || !active.contains(selection.anchorNode)) return;
        const caret = selection.getRangeAt(0).getBoundingClientRect();
        const scroller = active.closest<HTMLElement>(".notebook-editor");
        if (!scroller || !caret.height) return;
        const bounds = scroller.getBoundingClientRect();
        const bottom = Math.min(bounds.bottom, viewport.offsetTop + viewport.height) - 24;
        if (caret.bottom > bottom) scroller.scrollTop += caret.bottom - bottom;
        else if (caret.top < bounds.top + 12) scroller.scrollTop -= bounds.top + 12 - caret.top;
      });
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.style.removeProperty("--workspace-viewport-height");
      root.style.removeProperty("--workspace-viewport-top");
      delete root.dataset.workspaceShort;
    };
  }, []);
}
