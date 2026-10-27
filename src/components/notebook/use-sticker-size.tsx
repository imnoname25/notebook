"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { DEFAULT_STICKER_SIZE, clampStickerSize, stickerSizeKey, stickerSizeSchema, type StickerSize } from "@/lib/sticker-size";

export function useStickerSize(userId: string, noteId: string) {
  const [size, setSize] = useState(DEFAULT_STICKER_SIZE);
  const [resizing, setResizing] = useState(false);
  const gesture = useRef<{ pointer: number; x: number; y: number; width: number; height: number; previous: StickerSize; latest: StickerSize } | null>(null);
  const key = stickerSizeKey(userId, noteId);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try { const parsed = stickerSizeSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"));setSize(parsed.success ? parsed.data : DEFAULT_STICKER_SIZE); }
      catch { setSize(DEFAULT_STICKER_SIZE); }
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  function persist(next: StickerSize) { setSize(next);try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Optional presentation preference; content saves are independent. */ } }
  function finish(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const active = gesture.current;if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null;setResizing(false);
    if (cancel) setSize(active.previous);else persist(active.latest);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return {
    style: { "--sticker-width": `${size.width}px`, "--sticker-height": `${size.height}px` } as CSSProperties,
    resizing,
    handle: {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (event.button !== 0) return;
        event.preventDefault();event.stopPropagation();
        const rect = event.currentTarget.closest("article")!.getBoundingClientRect();
        gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, previous: size, latest: size };
        event.currentTarget.setPointerCapture(event.pointerId);setResizing(true);
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const active = gesture.current;if (!active || active.pointer !== event.pointerId) return;
        const next = clampStickerSize(active.width + event.clientX - active.x, active.height + event.clientY - active.y);
        active.latest = next;setSize(next);
      },
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event),
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
      onDoubleClick: () => persist(DEFAULT_STICKER_SIZE),
      onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
        const step = event.shiftKey ? 40 : 10;
        if (event.key === "Home") { event.preventDefault();persist(DEFAULT_STICKER_SIZE); }
        else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();persist(clampStickerSize(size.width + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), size.height + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0)));
        }
      },
      "aria-label": "Изменить размер стикера",
      "aria-description": `Ширина ${size.width}, высота ${size.height}. Стрелки — размер, Shift — крупный шаг, Home — сброс.`,
    },
  };
}
