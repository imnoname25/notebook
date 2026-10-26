"use client";

import {
  ArrowLeft,
  Ellipsis,
  FileText,
  GripVertical,
  LayoutTemplate,
  List,
  Rows3,
  ScanText,
  Plus,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ACCENT_DOT_CLASSES,
  resolveAppearanceAccent,
} from "@/lib/content-appearance";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/messages";
import { SortableItem, SortableList } from "./sortable";
import type { PageSummary, Section } from "./types";
import type { PageListView } from "@/lib/content-appearance";
import type { DocumentTab } from "@/lib/document-tabs";

type Props = {
  section: Section | null;
  pages: PageSummary[];
  activePageId: string | null;
  loading: boolean;
  density?: "comfortable" | "compact";
  notebookColor?: string;
  viewMode?: PageListView;
  onBack(): void;
  onAdd(): void;
  onAddFromTemplate(): void;
  onSelect(page: PageSummary, mode?: DocumentTab["mode"]): void;
  onMenu(page: PageSummary): void;
  onFavorite(page: PageSummary): void;
  onReorder(ids: string[]): void;
  onViewModeChange(mode: PageListView): void;
};

export function PageList(props: Props) {
  const ordered = [...props.pages].sort((a, b) => a.sortOrder - b.sortOrder);
  const viewMode = props.viewMode ?? "standard";
  return (
    <aside
      data-density={props.density}
      className="notebook-page-list flex h-full min-h-0 flex-col bg-background p-2 md:border-r md:border-border/60"
    >
      <div className="notebook-page-list-header mb-1 flex min-h-10 items-center gap-2 px-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:hidden"
          aria-label="Назад к блокнотам"
          onClick={props.onBack}
        >
          <ArrowLeft size={17} />
        </Button>
        <div className="notebook-page-list-heading min-w-0 flex-1">
          <p
            title={props.section?.title}
            className="truncate text-[15px] font-semibold"
          >
            {props.section?.title ?? "Страницы"}
          </p>
          <p className="notebook-list-count text-[12.5px] text-muted-foreground">
            {ordered.length} стр.
          </p>
        </div>
        <div className="notebook-list-view-switch hidden md:flex">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><button type="button" aria-label={t("appearance.pageListView")} title={t("appearance.pageListView")} className="notebook-list-view-trigger flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-accent"><Rows3 size={15}/></button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground">
              <DropdownMenu.RadioGroup value={viewMode} onValueChange={(value) => { if (value === "compact" || value === "standard" || value === "preview") props.onViewModeChange(value); }}>
                {([{id: "compact", label: t("appearance.listCompact"), icon: List}, {id: "standard", label: t("appearance.listStandard"), icon: Rows3}, {id: "preview", label: t("appearance.listPreview"), icon: ScanText}] as const).map(({id, label, icon: Icon}) => <DropdownMenu.RadioItem key={id} value={id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm outline-none data-[highlighted]:bg-accent data-[state=checked]:font-semibold"><Icon size={14}/>{label}</DropdownMenu.RadioItem>)}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          onClick={props.onAddFromTemplate}
          disabled={!props.section}
          aria-label="Создать из шаблона"
          title="Создать из шаблона"
        >
          <LayoutTemplate size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:size-8"
          onClick={props.onAdd}
          disabled={!props.section}
          aria-label="Новая страница"
        >
          <Plus size={17} />
        </Button>
      </div>
      <div className="notebook-document-list min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {!props.section && (
          <div className="p-5 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-3 opacity-40" />
            Выберите раздел
          </div>
        )}
        {props.loading && (
          <div className="space-y-1 p-1">
            <div className="h-12 animate-pulse rounded-md bg-muted" />
            <div className="h-12 animate-pulse rounded-md bg-muted" />
          </div>
        )}
        {!props.loading && props.section && ordered.length === 0 && (
          <div className="p-5 text-center text-sm text-muted-foreground">
            <p className="mb-3">В разделе пока нет страниц.</p>
            <Button size="sm" onClick={props.onAdd}>
              <Plus size={14} />
              Новая страница
            </Button>
          </div>
        )}
        {!props.loading && (
          <SortableList
            ids={ordered.map((page) => page.id)}
            onReorder={props.onReorder}
          >
            {ordered.map((page) => (
              <SortableItem id={page.id} key={page.id}>
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
                    data-page-title={page.title}
                    data-page-icon={page.icon ?? ""}
                    data-page-color={resolveAppearanceAccent(
                      page.color,
                      props.section?.color,
                      props.notebookColor,
                    )}
                    data-list-view={viewMode}
                    data-page-background={page.backgroundType}
                    aria-current={
                      props.activePageId === page.id ? "page" : undefined
                    }
                    className={cn(
                      "notebook-page-row group flex rounded-lg border border-transparent",
                      props.activePageId === page.id
                        ? "text-accent-foreground"
                        : "hover:bg-accent/60",
                      isDragging && "opacity-60 shadow-md",
                      isOver && !isDragging && "ring-1 ring-primary/40",
                    )}
                  >
                    <button
                      className="my-auto ml-0.5 w-5 shrink-0 touch-none rounded py-1 text-muted-foreground/60 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Перетащить страницу ${page.title}`}
                      {...attributes}
                      {...listeners}
                    >
                      <GripVertical size={13} />
                    </button>
                    <button
                      title={page.title}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 px-1.5 text-left",
                        viewMode === "compact"
                          ? "py-1"
                          : viewMode === "preview"
                            ? "py-2.5"
                            : "py-1.5",
                      )}
                      onClick={(event) => { if (event.detail > 1) return;props.onSelect(page, event.ctrlKey || event.metaKey ? "permanent" : "preview"); }}
                      onDoubleClick={() => props.onSelect(page, "permanent")}
                    >
                      {page.coverUploadId && viewMode !== "compact" ? (
                        <Image className="notebook-document-thumbnail" src={`/api/uploads/${page.coverUploadId}`} alt="" width={52} height={52} unoptimized />
                      ) : page.icon ? (
                        <span className="w-5 shrink-0 text-center text-base">
                          {page.icon}
                        </span>
                      ) : (
                        <FileText
                          size={15}
                          className={cn(
                            "shrink-0",
                            ACCENT_DOT_CLASSES[
                              resolveAppearanceAccent(
                                page.color,
                                props.section?.color,
                                props.notebookColor,
                              )
                            ],
                          )}
                        />
                      )}
                      <span className="notebook-document-meta min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[14.5px] font-medium">
                            {page.title || "Без названия"}
                          </span>
                          {page.isFavorite && (
                            <Star
                              size={11}
                              className="notebook-favorite-indicator shrink-0 fill-current text-amber-500"
                            />
                          )}
                        </span>
                        {viewMode !== "compact" && page.previewText && (
                          <span className={cn("notebook-document-preview break-words text-[12.5px] leading-[1.35] text-muted-foreground", viewMode === "preview" ? "line-clamp-2" : "line-clamp-1")}>{page.previewText}</span>
                        )}
                        {viewMode !== "compact" && (
                          <time dateTime={page.updatedAt} className="notebook-document-date mt-0.5 block text-[12.5px] text-muted-foreground">
                            {new Intl.DateTimeFormat("ru", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            }).format(new Date(page.updatedAt))}
                          </time>
                        )}
                        {viewMode === "preview" && !page.previewText && (
                          <span className="mt-1 line-clamp-2 break-words text-[12.5px] leading-[1.35] text-muted-foreground">
                            {page.previewText || t("appearance.emptyPage")}
                          </span>
                        )}
                        {viewMode === "preview" && page.tags && page.tags.length > 0 && (
                          <span className="mt-1.5 flex min-w-0 gap-1 overflow-hidden">
                            {page.tags.slice(0, 3).map((tag) => <span key={tag.normalized} className="notebook-tag-chip pointer-events-none max-w-24 truncate">#{tag.name}</span>)}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      className="my-auto flex size-11 shrink-0 items-center justify-center rounded opacity-100 hover:bg-background md:size-7 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                      onClick={() => props.onFavorite(page)}
                      aria-pressed={page.isFavorite}
                      aria-label={`Избранное: ${page.title}`}
                    >
                      <Star size={14} />
                    </button>
                    <button
                      className="my-auto mr-0.5 flex size-11 shrink-0 items-center justify-center rounded opacity-100 hover:bg-background md:size-7 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                      onClick={() => props.onMenu(page)}
                      aria-label={`Действия страницы ${page.title}`}
                    >
                      <Ellipsis size={14} />
                    </button>
                  </div>
                )}
              </SortableItem>
            ))}
          </SortableList>
        )}
      </div>
    </aside>
  );
}
