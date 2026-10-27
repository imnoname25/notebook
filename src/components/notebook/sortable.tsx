"use client";

import type { CSSProperties, ReactNode } from "react";
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function SortableList({ ids, onReorder, children, strategy = "vertical", rowDrag = false }: { ids: string[]; onReorder(ids: string[]): void; children: ReactNode; strategy?: "vertical" | "rect"; rowDrag?: boolean }) {
  // Expanded tree branches have different heights. Align centers explicitly so
  // keyboard movement selects the next sibling rather than the expanded source.
  const rowCoordinates: KeyboardCoordinateGetter = (event, args) => {
    if (event.code !== "ArrowDown" && event.code !== "ArrowUp") return sortableKeyboardCoordinates(event, args);
    event.preventDefault();
    const { active, over, collisionRect, droppableRects } = args.context;
    if (!active || !collisionRect) return;
    const index = ids.indexOf(String(over?.id ?? active.id));
    const target = ids[index + (event.code === "ArrowDown" ? 1 : -1)];
    const rect = target ? droppableRects.get(target) : undefined;
    if (!rect) return;
    return { x: args.currentCoordinates.x + rect.left + rect.width / 2 - collisionRect.left - collisionRect.width / 2, y: args.currentCoordinates.y + rect.top + rect.height / 2 - collisionRect.top - collisionRect.height / 2 };
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rowSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: rowCoordinates }),
  );

  function dragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex >= 0 && newIndex >= 0) onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return <DndContext sensors={rowDrag ? rowSensors : sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
    <SortableContext items={ids} strategy={strategy === "rect" ? rectSortingStrategy : verticalListSortingStrategy}>{children}</SortableContext>
  </DndContext>;
}

export type SortableRenderState = {
  setNodeRef(node: HTMLElement | null): void;
  style: CSSProperties;
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  isDragging: boolean;
  isOver: boolean;
};

export function SortableItem({ id, children }: { id: string; children(state: SortableRenderState): ReactNode }) {
  const sortable = useSortable({ id });
  const style: CSSProperties = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition, zIndex: sortable.isDragging ? 20 : undefined, position: "relative" };
  return children({ setNodeRef: sortable.setNodeRef, style, attributes: sortable.attributes, listeners: sortable.listeners, isDragging: sortable.isDragging, isOver: sortable.isOver });
}
