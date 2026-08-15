"use client";

import { ArrowLeft, Ellipsis, FileText, GripVertical, LayoutTemplate, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SortableItem, SortableList } from "./sortable";
import type { PageSummary, Section } from "./types";

type Props = { section: Section | null; pages: PageSummary[]; activePageId: string | null; loading: boolean; onBack(): void; onAdd(): void; onAddFromTemplate(): void; onSelect(page: PageSummary): void; onMenu(page: PageSummary): void; onFavorite(page: PageSummary): void; onReorder(ids: string[]): void };

export function PageList(props: Props) {
  const ordered = [...props.pages].sort((a, b) => a.sortOrder - b.sortOrder);
  return <aside className="flex h-full min-h-0 flex-col bg-background p-3 md:border-r md:border-border/60">
    <div className="mb-2 flex min-h-9 items-center gap-2 px-1">
      <Button variant="ghost" size="icon" className="size-11 md:hidden" onClick={props.onBack}><ArrowLeft size={17} /></Button>
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{props.section?.title ?? "Страницы"}</p><p className="text-xs text-muted-foreground">{ordered.length} стр.</p></div>
      <Button variant="ghost" size="icon" className="size-11 md:size-8" onClick={props.onAddFromTemplate} disabled={!props.section} aria-label="Создать из шаблона" title="Создать из шаблона"><LayoutTemplate size={16}/></Button><Button variant="ghost" size="icon" className="size-11 md:size-8" onClick={props.onAdd} disabled={!props.section} aria-label="Новая страница"><Plus size={17} /></Button>
    </div>
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
      {!props.section && <div className="p-5 text-center text-sm text-muted-foreground"><FileText className="mx-auto mb-3 opacity-40" />Выберите раздел</div>}
      {props.loading && <div className="space-y-2 p-1"><div className="h-16 animate-pulse rounded-xl bg-muted"/><div className="h-16 animate-pulse rounded-xl bg-muted"/></div>}
      {!props.loading && props.section && ordered.length === 0 && <div className="p-5 text-center text-sm text-muted-foreground"><p className="mb-3">В разделе пока нет страниц.</p><Button size="sm" onClick={props.onAdd}><Plus size={14} />Новая страница</Button></div>}
      {!props.loading && <SortableList ids={ordered.map((page) => page.id)} onReorder={props.onReorder}>{ordered.map((page) => <SortableItem id={page.id} key={page.id}>{({ setNodeRef, style, attributes, listeners, isDragging, isOver }) => <div ref={setNodeRef} style={style} data-page-title={page.title} className={cn("group flex rounded-xl", props.activePageId === page.id ? "bg-accent" : "hover:bg-accent/60", isDragging && "opacity-60 shadow-md", isOver && !isDragging && "ring-1 ring-primary/40")}>
        <button className="my-auto ml-1 touch-none rounded p-1 text-muted-foreground/60 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Перетащить страницу ${page.title}`} {...attributes} {...listeners}><GripVertical size={14} /></button>
        <button className="min-w-0 flex-1 px-2 py-2.5 text-left" onClick={() => props.onSelect(page)}><div className="flex items-center gap-1.5"><p className="truncate text-sm font-medium">{page.title || "Без названия"}</p>{page.isFavorite && <Star size={12} className="shrink-0 fill-current text-amber-500" />}</div><time className="mt-1 block text-xs text-muted-foreground">{new Intl.DateTimeFormat("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(page.updatedAt))}</time></button>
        <button className="my-auto flex size-11 items-center justify-center rounded-lg opacity-100 hover:bg-background md:size-8 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100" onClick={() => props.onFavorite(page)} aria-label={`Избранное: ${page.title}`}><Star size={14} /></button>
        <button className="my-auto mr-1 flex size-11 items-center justify-center rounded-lg opacity-100 hover:bg-background md:size-8 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100" onClick={() => props.onMenu(page)} aria-label={`Действия страницы ${page.title}`}><Ellipsis size={14} /></button>
      </div>}</SortableItem>)}</SortableList>}
    </div>
  </aside>;
}
