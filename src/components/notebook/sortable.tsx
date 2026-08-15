"use client";

import type { CSSProperties, ReactNode } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function SortableList({ ids, onReorder, children }: { ids: string[]; onReorder(ids: string[]): void; children: ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function dragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex >= 0 && newIndex >= 0) onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>
  </DndContext>;
}

type SortableRenderState = {
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
