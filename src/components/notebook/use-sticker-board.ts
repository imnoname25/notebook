"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { addBoardCards, arrangeCards, boardLayoutKey, boardLayoutSchema, boardPoint, frontCard, type BoardCard, type BoardLayout } from "@/lib/sticker-board-layout";
import { clampStickerSize, DEFAULT_STICKER_SIZE, stickerSizeKey } from "@/lib/sticker-size";

const subscribe = (notify: () => void) => { const query = matchMedia("(min-width: 1200px)");query.addEventListener("change", notify);return () => query.removeEventListener("change", notify); };
const desktopSnapshot = () => matchMedia("(min-width: 1200px)").matches;
type Gesture = { id: string; pointer: number; kind: "move" | "resize"; x: number; y: number; scrollX: number; scrollY: number; before: BoardCard; moved: boolean };
export function useStickerBoard(userId: string, ids: string[], viewport: RefObject<HTMLDivElement | null>, onError: (error: unknown) => void) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, () => false);
  const [cards, setCards] = useState<BoardLayout>({});const current = useRef<BoardLayout>({});
  const [loaded, setLoaded] = useState(false);const [active, setActive] = useState<string | null>(null);
  const [gestureId, setGestureId] = useState<string | null>(null);const gesture = useRef<Gesture | null>(null);
  const [undo, setUndo] = useState<BoardLayout | null>(null);const skipClick = useRef<string | null>(null);
  const key = boardLayoutKey(userId);
  const commit = useCallback((next: BoardLayout, persist = true) => {
    current.current = next;setCards(next);
    if (persist) try { localStorage.setItem(key, JSON.stringify({ version: 1, cards: next })); } catch { onError(new Error("Не удалось сохранить расположение стикеров на этом устройстве")); }
  }, [key, onError]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try { const parsed = boardLayoutSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"));commit(parsed.success ? parsed.data.cards : {}, false); } catch { commit({}, false); }
      setLoaded(true);
    });return () => cancelAnimationFrame(frame);
  }, [key, commit]);
  const idsKey = JSON.stringify(ids);
  useEffect(() => {
    if (!desktop || !loaded) return;
    const noteIds = JSON.parse(idsKey) as string[];
    if (noteIds.every(id => current.current[id])) return;
    const next = addBoardCards(noteIds, current.current, viewport.current?.clientWidth ?? 900, id => {
      try { return JSON.parse(localStorage.getItem(stickerSizeKey(userId, id)) ?? "null") as unknown; } catch { return null; }
    });commit(frontCard(next, ""));
  }, [desktop, loaded, idsKey, userId, commit, viewport]);
  const select = useCallback((id: string, scroll = false) => {
    if (!desktop || !current.current[id] || (gesture.current && gesture.current.id !== id)) return;
    setActive(id);
    const next = frontCard(current.current, id);
    if (next[id]!.z !== current.current[id]!.z) commit(next);
    if (scroll) {
      const card = next[id]!;viewport.current?.scrollTo({ left: Math.max(0, card.x - 16), top: Math.max(0, card.y - 16), behavior: "instant" });
      viewport.current?.querySelector<HTMLElement>(`[data-sticker-id="${CSS.escape(id)}"] .sticker-move-handle`)?.focus({ preventScroll: true });
    }
  }, [desktop, commit, viewport]);
  function end(event: PointerEvent<HTMLElement>, cancel = false) {
    const drag = gesture.current;if (!drag || drag.pointer !== event.pointerId) return;
    gesture.current = null;setGestureId(null);
    if (cancel || !desktop) commit({ ...current.current, [drag.id]: drag.before }, false);
    else { commit(current.current);if (drag.moved && drag.kind === "move") skipClick.current = drag.id; }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function handlers(id: string, kind: "move" | "resize") {
    return {
      "aria-description": kind === "move" ? "Стрелки перемещают стикер на 10 пикселей, Shift — на 40. Нажатие открывает название для редактирования." : "Стрелки изменяют размер, Shift — крупный шаг. Home или двойное нажатие возвращают стандартный размер.",
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (!desktop || event.button !== 0 || !current.current[id] || gesture.current) return;
        event.preventDefault();event.stopPropagation();select(id);setUndo(null);skipClick.current = null;
        gesture.current = { id, kind, pointer: event.pointerId, x: event.clientX, y: event.clientY, scrollX: viewport.current?.scrollLeft ?? 0, scrollY: viewport.current?.scrollTop ?? 0, before: current.current[id]!, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const drag = gesture.current;if (!desktop || !drag || drag.id !== id || drag.pointer !== event.pointerId) return;
        const dx = event.clientX - drag.x + (viewport.current?.scrollLeft ?? 0) - drag.scrollX;
        const dy = event.clientY - drag.y + (viewport.current?.scrollTop ?? 0) - drag.scrollY;
        if (!drag.moved && Math.hypot(dx, dy) < 5) return;
        drag.moved = true;setGestureId(id);
        const next = kind === "move" ? { ...drag.before, x: boardPoint(drag.before.x + dx), y: boardPoint(drag.before.y + dy) } : { ...drag.before, ...clampStickerSize(drag.before.width + dx, drag.before.height + dy) };
        commit({ ...current.current, [id]: next }, false);
        const scroller = viewport.current;
        if (scroller) { const box = scroller.getBoundingClientRect();scroller.scrollBy(event.clientX > box.right - 32 ? 12 : event.clientX < box.left + 32 ? -12 : 0, event.clientY > box.bottom - 32 ? 12 : event.clientY < box.top + 32 ? -12 : 0); }
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => end(event),
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => end(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => end(event, true),
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (!desktop) return;
        if (event.key === "Escape" && gesture.current) { const drag = gesture.current;gesture.current = null;setGestureId(null);commit({ ...current.current, [id]: drag.before }, false);return; }
        const card = current.current[id];if (!card) return;
        if (kind === "resize" && event.key === "Home") { event.preventDefault();setUndo(null);commit({ ...current.current, [id]: { ...card, ...DEFAULT_STICKER_SIZE } });return; }
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();event.stopPropagation();select(id);setUndo(null);
        const step = event.shiftKey ? 40 : 10;const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        commit({ ...current.current, [id]: kind === "move" ? { ...current.current[id]!, x: boardPoint(card.x + dx), y: boardPoint(card.y + dy) } : { ...current.current[id]!, ...clampStickerSize(card.width + dx, card.height + dy) } });
        requestAnimationFrame(() => viewport.current?.querySelector<HTMLElement>(`[data-sticker-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
      },
    };
  }
  function style(id: string): CSSProperties | undefined { const card = cards[id];return desktop && card ? { left: card.x, top: card.y, width: card.width, height: card.height, zIndex: card.z } : undefined; }
  const visible = ids.map(id => cards[id]).filter((card): card is BoardCard => Boolean(card));
  return { desktop, ready: !desktop || loaded && ids.every(id => cards[id]), active, gestureId, cards, style, select, handlers,
    canvasStyle: desktop ? { width: Math.max(1, ...visible.map(card => card.x + card.width + 64)), height: Math.max(1, ...visible.map(card => card.y + card.height + 64)) } : undefined,
    consumeDragClick(id: string) { if (skipClick.current === id) { skipClick.current = null;return true; }return false; },
    resetSize(id: string) { const card = current.current[id];if (desktop && card) { setUndo(null);commit({ ...current.current, [id]: { ...card, ...DEFAULT_STICKER_SIZE } }); } },
    arrange() { if (desktop) { setUndo(current.current);commit(arrangeCards(ids, current.current, viewport.current?.clientWidth ?? 900)); } },
    canUndo: Boolean(undo), undo() { if (desktop && undo) { commit({ ...current.current, ...undo });setUndo(null); } },
  };
}
