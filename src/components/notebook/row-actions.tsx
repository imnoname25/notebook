"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortableRenderState } from "./sortable";

type RowSelectProps = ComponentProps<"button"> & Pick<SortableRenderState, "listeners"> & {
  nativeAndroid: boolean;
  actionsMode: boolean;
  onActions(): void;
};

export function RowSelect({
  nativeAndroid, actionsMode, listeners, onActions, onClick, onDoubleClick, onKeyDown, className, ...props
}: RowSelectProps) {
  const press = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const lastPointerType = useRef("");
  const opened = useRef(false);
  const cancel = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => () => {
    if (press.current) window.clearTimeout(press.current.timer);
  }, []);

  const openFromPress = (target: HTMLButtonElement) => {
    cancel();
    opened.current = true;
    target.focus({ preventScroll: true });
    onActions();
  };

  return <button
    {...listeners}
    {...props}
    className={cn(className, nativeAndroid && "select-none")}
    onTouchStart={nativeAndroid ? undefined : event => listeners?.onTouchStart?.(event)}
    aria-keyshortcuts="Shift+F10 ContextMenu"
    aria-haspopup={actionsMode ? "dialog" : undefined}
    onPointerDown={event => {
      lastPointerType.current = event.pointerType;
      opened.current = false;
      cancel();
      if (!nativeAndroid || event.pointerType !== "touch" || !event.isPrimary) return;
      const { pointerId, clientX, clientY, currentTarget } = event;
      press.current = { id: pointerId, x: clientX, y: clientY, timer: window.setTimeout(() => openFromPress(currentTarget), 500) };
    }}
    onPointerMove={event => {
      const start = press.current;
      if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancel();
    }}
    onPointerUp={cancel}
    onPointerCancel={cancel}
    onLostPointerCapture={cancel}
    onTouchEnd={event => {
      // A completed hold has already opened the dialog. Prevent the
      // compatibility click on release from dismissing it or opening the row.
      if (opened.current) event.preventDefault();
    }}
    onContextMenu={event => {
      const pointerType = (event.nativeEvent as PointerEvent).pointerType || lastPointerType.current;
      if (!nativeAndroid && pointerType === "touch") return;
      event.preventDefault();
      if (nativeAndroid && press.current) {
        openFromPress(event.currentTarget);
      } else if (pointerType !== "touch" && !opened.current) {
        event.currentTarget.focus({ preventScroll: true });
        onActions();
      }
    }}
    onKeyDown={event => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        onActions();
      } else if (onKeyDown) onKeyDown(event);
      else listeners?.onKeyDown?.(event);
    }}
    onClick={event => {
      if (opened.current && event.detail > 0) return;
      if (actionsMode) onActions();
      else onClick?.(event);
    }}
    onDoubleClick={event => {
      if (!opened.current && !actionsMode) onDoubleClick?.(event);
    }}
  />;
}

export function NativeRowDragHandle({ listeners }: Pick<SortableRenderState, "listeners">) {
  return <span
    aria-hidden="true"
    data-row-drag-handle
    className="flex min-h-11 w-8 shrink-0 touch-none items-center justify-center text-muted-foreground"
    onTouchStart={event => listeners?.onTouchStart?.(event)}
    onMouseDown={event => listeners?.onMouseDown?.(event)}
    onContextMenu={event => event.preventDefault()}
  ><GripVertical size={15} /></span>;
}
