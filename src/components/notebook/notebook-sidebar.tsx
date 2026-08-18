"use client";

import {
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderPlus,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCENT_DOT_CLASSES, isAccentColor } from "@/lib/content-appearance";
import {
  isNotebookColor,
  isNotebookIcon,
  NOTEBOOK_COLOR_CLASSES,
  NOTEBOOK_ICON_COMPONENTS,
} from "@/lib/notebook-appearance";
import { cn } from "@/lib/utils";
import { SortableItem, SortableList } from "./sortable";
import type { Notebook, Section } from "./types";

type Props = {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  activeSectionId: string | null;
  density?: "comfortable" | "compact";
  onNotebookSelect(id: string): void;
  onSectionSelect(section: Section): void;
  onAddNotebook(): void;
  onNotebookMenu(notebook: Notebook): void;
  onAddSection(notebookId: string, parentId?: string): void;
  onSectionMenu(section: Section): void;
  onNotebookReorder(ids: string[]): void;
  onSectionReorder(
    notebookId: string,
    parentId: string | null,
    ids: string[],
  ): void;
  onTrashOpen(): void;
};

function SectionTree({
  notebookId,
  sections,
  parentId,
  activeId,
  onSelect,
  onAdd,
  onMenu,
  onReorder,
  depth = 0,
}: {
  notebookId: string;
  sections: Section[];
  parentId: string | null;
  activeId: string | null;
  onSelect(section: Section): void;
  onAdd(parentId: string): void;
  onMenu(section: Section): void;
  onReorder(notebookId: string, parentId: string | null, ids: string[]): void;
  depth?: number;
}) {
  const siblings = sections
    .filter((section) => section.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <SortableList
      ids={siblings.map((section) => section.id)}
      onReorder={(ids) => onReorder(notebookId, parentId, ids)}
    >
      {siblings.map((section) => (
        <SortableItem id={section.id} key={section.id}>
          {({
            setNodeRef,
            style,
            attributes,
            listeners,
            isDragging,
            isOver,
          }) => (
            <div
              ref={setNodeRef}
              style={style}
              className={cn(
                isDragging && "opacity-60",
                isOver && !isDragging && "rounded-md ring-1 ring-primary/40",
              )}
            >
              <div
                data-nav-row="section"
                className={cn(
                  "group flex items-center rounded-md text-[14px] font-medium",
                  activeId === section.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                style={{ paddingLeft: 4 + depth * 10 }}
              >
                <button
                  className="w-5 shrink-0 touch-none rounded py-1 text-muted-foreground/60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Перетащить раздел ${section.title}`}
                  {...attributes}
                  {...listeners}
                >
                  <GripVertical size={13} />
                </button>
                <button
                  title={section.title}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left md:min-h-9"
                  onClick={() => onSelect(section)}
                >
                  <Folder
                    size={15}
                    className={cn(
                      "shrink-0",
                      ACCENT_DOT_CLASSES[
                        isAccentColor(section.color) ? section.color : "default"
                      ],
                    )}
                  />
                  <span className="truncate">{section.title}</span>
                </button>
                <button
                  className="flex size-11 shrink-0 items-center justify-center rounded opacity-100 hover:bg-background md:size-7 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  aria-label={`Действия раздела ${section.title}`}
                  onClick={() => onMenu(section)}
                >
                  <Ellipsis size={14} />
                </button>
                <button
                  className="mr-0.5 flex size-11 shrink-0 items-center justify-center rounded hover:bg-background md:size-7 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  aria-label="Добавить вложенный раздел"
                  onClick={() => onAdd(section.id)}
                >
                  <FolderPlus size={14} />
                </button>
              </div>
              <SectionTree
                notebookId={notebookId}
                sections={sections}
                parentId={section.id}
                activeId={activeId}
                onSelect={onSelect}
                onAdd={onAdd}
                onMenu={onMenu}
                onReorder={onReorder}
                depth={depth + 1}
              />
            </div>
          )}
        </SortableItem>
      ))}
    </SortableList>
  );
}

export function NotebookSidebar(props: Props) {
  const ordered = [...props.notebooks].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  return (
    <aside
      data-density={props.density}
      className="notebook-sidebar flex h-full min-h-0 flex-col bg-sidebar p-2 md:border-r md:border-border/60"
    >
      <div className="mb-1 flex h-9 items-center justify-between px-1.5">
        <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Блокноты
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={props.onAddNotebook}
          aria-label="Добавить блокнот"
        >
          <Plus size={16} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {ordered.length === 0 && (
          <div className="p-3 text-sm text-muted-foreground">
            <p className="mb-3">Здесь появятся ваши блокноты.</p>
            <Button size="sm" onClick={props.onAddNotebook}>
              <Plus size={14} />
              Создать блокнот
            </Button>
          </div>
        )}
        <SortableList
          ids={ordered.map((item) => item.id)}
          onReorder={props.onNotebookReorder}
        >
          {ordered.map((notebook) => {
            const active = notebook.id === props.activeNotebookId;
            const Icon =
              NOTEBOOK_ICON_COMPONENTS[
                isNotebookIcon(notebook.icon) ? notebook.icon : "notebook"
              ];
            const color =
              NOTEBOOK_COLOR_CLASSES[
                isNotebookColor(notebook.color) ? notebook.color : "slate"
              ];
            return (
              <SortableItem id={notebook.id} key={notebook.id}>
                {({
                  setNodeRef,
                  style,
                  attributes,
                  listeners,
                  isDragging,
                  isOver,
                }) => (
                  <section
                    ref={setNodeRef}
                    style={style}
                    data-notebook-title={notebook.title}
                    data-notebook-color={notebook.color}
                    data-notebook-icon={notebook.icon}
                    className={cn(
                      isDragging && "opacity-60",
                      isOver &&
                        !isDragging &&
                        "rounded-md ring-1 ring-primary/40",
                    )}
                  >
                    <div
                      data-nav-row="notebook"
                      className={cn(
                        "group flex items-center rounded-md",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "hover:bg-sidebar-accent/60",
                      )}
                    >
                      <button
                        className="w-5 shrink-0 touch-none rounded py-1 text-muted-foreground/60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Перетащить блокнот ${notebook.title}`}
                        {...attributes}
                        {...listeners}
                      >
                        <GripVertical size={13} />
                      </button>
                      <button
                        title={notebook.title}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-[15px] font-semibold md:min-h-10"
                        onClick={() => props.onNotebookSelect(notebook.id)}
                      >
                        {active ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )}
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded text-white",
                            color,
                          )}
                        >
                          <Icon size={14} />
                        </span>
                        <span className="truncate">{notebook.title}</span>
                      </button>
                      <button
                        className="mr-0.5 flex size-11 shrink-0 items-center justify-center rounded hover:bg-background md:size-8 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                        aria-label={`Действия блокнота ${notebook.title}`}
                        onClick={() => props.onNotebookMenu(notebook)}
                      >
                        <Ellipsis size={15} />
                      </button>
                    </div>
                    {active && (
                      <div className="mt-0.5">
                        <SectionTree
                          notebookId={notebook.id}
                          sections={notebook.sections}
                          parentId={null}
                          activeId={props.activeSectionId}
                          onSelect={props.onSectionSelect}
                          onAdd={(parent) =>
                            props.onAddSection(notebook.id, parent)
                          }
                          onMenu={props.onSectionMenu}
                          onReorder={props.onSectionReorder}
                        />
                        <button
                          className="ml-6 mt-0.5 flex min-h-11 items-center gap-2 rounded-md px-2 text-[13.5px] text-muted-foreground hover:bg-accent hover:text-foreground md:min-h-9"
                          onClick={() => props.onAddSection(notebook.id)}
                        >
                          <Plus size={14} />
                          Новый раздел
                        </button>
                      </div>
                    )}
                  </section>
                )}
              </SortableItem>
            );
          })}
        </SortableList>
      </div>
      <button
        className="mt-1 flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={props.onTrashOpen}
      >
        <Trash2 size={16} />
        Корзина
      </button>
    </aside>
  );
}
