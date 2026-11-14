"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, ArrowUpRight, Bookmark, Ellipsis, FileText, ImageIcon, Link2, MessageSquare, Plus, Search, Video } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/messages";
import { SavedItemDialog, type SavedDialogAction } from "./saved-item-dialog";
import { SavedArticleControls, SavedArticleReader, savedArticleHeading, useSavedArticle } from "./saved-article-reader";
import { savedError, savedItemEndpoint, savedSource, savedTitle, useSavedItem, useSavedItems, type SavedItem } from "./saved-items-client";
import type { Notebook } from "./types";

const views = [{ id: "all", name: "Все" }, { id: "pending", name: "Неразобранное" }, { id: "archive", name: "Архив" }] as const;
type View = (typeof views)[number]["id"];
const date = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short", year: "numeric" });
const linkKinds = { article: { label: "Ссылка", icon: Link2 }, video: { label: "Видео", icon: Video }, social: { label: "Публикация", icon: MessageSquare } };

function metadataPreview(item: SavedItem) {
  if (!item.metadata.hasPreview || (item.hasSavedArticle && item.linkKind === "article")) return undefined;
  return `${savedItemEndpoint(item.id)}/preview`;
}

function MaterialPreview({ source, className, onError }: { source: string; className: string; onError?(): void }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // Both sources are authenticated routes with validated bytes and no public cache.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={source} alt="" loading="lazy" decoding="async" className={className} onError={() => {
    setFailed(true);
    onError?.();
  }}/>;
}

function DetailPreview({ source }: { source: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  return failed ? <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
    <span role="status">Не удалось загрузить обложку.</span>
    <Button type="button" variant="ghost" className="min-h-11" onClick={() => {
      setAttempt(value => value + 1);
      setFailed(false);
    }}>Повторить загрузку обложки</Button>
  </div> : <MaterialPreview key={attempt} source={attempt ? `${source}?retry=${attempt}` : source}
    className="max-h-72 max-w-full rounded-xl object-contain" onError={() => setFailed(true)}/>;
}

function videoCoverMissing(item: SavedItem) {
  return item.linkKind === "video" && !item.metadata.hasPreview
    && (item.metadataStatus === "ready" || item.metadataStatus === "empty");
}

function metadataStatusLabel(item: SavedItem) {
  if (item.metadataStatus === "queued") return "Получаем превью…";
  if (item.metadataStatus === "failed") {
    switch (item.metadataFailure) {
      case "access": return "Источник ограничил доступ к превью.";
      case "dns": return "Ошибка DNS при получении превью.";
      case "tls": return "Ошибка TLS при получении превью.";
      case "timeout": return "Источник не ответил вовремя при получении превью.";
      case "request": return "Сетевая ошибка при получении превью.";
      case "http": return "Источник вернул HTTP-ошибку при получении превью.";
      default: return "Ошибка получения превью.";
    }
  }
  if (videoCoverMissing(item)) return "Нет доступной обложки.";
  if (item.metadataStatus === "empty") return "Превью недоступно";
  return null;
}

function SavedFacts({ item }: { item: SavedItem }) {
  const host = savedSource(item).replace(/^www\./u, "");
  const siteName = item.metadata.siteName;
  return <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
    {item.linkKind && <span className="font-medium text-foreground">{linkKinds[item.linkKind].label}</span>}
    {siteName && siteName.replace(/^www\./u, "") !== host && <span className="max-w-full [overflow-wrap:anywhere]">{siteName}</span>}
    {host && <span className="max-w-full break-all">{host}</span>}
    <time dateTime={item.createdAt}>{date.format(new Date(item.createdAt))}</time>
    <span>{item.reviewStatus === "pending" ? "Неразобранное" : "Разобрано"}</span>
  </span>;
}

function SavedTags({ item, onTag }: { item: SavedItem; onTag(tag: string): void }) {
  if (!item.tags.length) return null;
  return <div className="flex flex-wrap gap-1">
    {item.tags.map(tag => <Button key={tag.normalized} type="button" variant="secondary" className="min-h-11 max-w-full whitespace-normal break-all px-2 text-xs" onClick={() => onTag(tag.normalized)}>#{tag.name}</Button>)}
  </div>;
}

function SavedCard({ item, selected, onSelect, onTag }: { item: SavedItem; selected: boolean; onSelect(): void; onTag(tag: string): void }) {
  const attachment = item.attachments.find(file => file.mimeType.startsWith("image/"));
  const Icon = item.linkKind ? linkKinds[item.linkKind].icon : attachment ? ImageIcon : FileText;
  const excerpt = item.metadata.description || item.text;
  const source = attachment?.url ?? (selected ? undefined : metadataPreview(item));
  const metadataLabel = metadataStatusLabel(item);
  return <li className={cn("notebook-surface min-w-0 rounded-xl px-3 pb-2", selected && "ring-2 ring-primary/50")}>
    <button type="button" aria-current={selected ? "true" : undefined} onClick={onSelect} className="block min-h-11 w-full min-w-0 rounded-lg py-3 text-left focus-visible:outline-2 focus-visible:outline-ring">
      {source && <MaterialPreview key={`${source}:${item.updatedAt}`} source={source} className="mb-2 aspect-[2.5] w-full rounded-lg bg-muted object-cover"/>}
      <span className="mb-1 flex items-start gap-2"><Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground"/><strong className="line-clamp-2 min-w-0 break-words text-sm font-semibold">{savedTitle(item)}</strong></span>
      <SavedFacts item={item}/>
      {excerpt && <span className="mt-2 line-clamp-2 break-words text-sm text-muted-foreground">{excerpt}</span>}
      {item.attachments.some(file => file.mimeType === "application/pdf") && <span className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><FileText size={13}/>PDF</span>}
      {metadataLabel && <span className="mt-2 block text-xs text-muted-foreground">{metadataLabel}</span>}
    </button>
    <SavedTags item={item} onTag={onTag}/>
  </li>;
}

function SavedDetail({ item, busy, onTag, onDialog, onPatch, onRetry, onPage, onArticleDiscarded }: {
  item: SavedItem; busy: boolean; onTag(tag: string): void; onDialog(action: SavedDialogAction): void;
  onPatch(patch: { archived: boolean } | { reviewStatus: "pending" | "reviewed" } | { useWebsiteTitle: true }): void;
  onRetry(): void; onPage(id: string): void; onArticleDiscarded(): void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const canSaveArticle = item.linkKind === "article";
  const readsArticle = canSaveArticle || item.hasSavedArticle;
  const reader = useSavedArticle(item.id, readsArticle);
  const article = reader.state?.article;
  const usableArticle = article?.browserPlaceholder ? null : article;
  const preview = metadataPreview(item);
  const canRetryMetadata = item.metadataStatus === "failed" || videoCoverMissing(item);
  const metadataLabel = metadataStatusLabel(item);
  const savedLabel = usableArticle ? "Сохранена статья"
    : item.hasSavedArticle && !reader.state && !reader.error ? null : "Сохранена карточка";
  const articleHeading = savedArticleHeading(usableArticle);
  const protectedTitle = item.titleOrigin === "manual" || item.titleOrigin === "legacy";
  const title = protectedTitle ? savedTitle(item) : articleHeading.title || savedTitle(item);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const element = heading.current;
    if (!element) return;
    function measure() {
      if (!element) return;
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
      setCanExpand(element.scrollHeight > lineHeight * 3 + 1);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [title, expanded]);
  const pageId = item.convertedPageId;
  const pageAction = pageId
    ? { label: "Открыть страницу", run: () => onPage(pageId) }
    : !item.convertedAt ? { label: "Перенести в страницу", run: () => onDialog({ type: "convert", item }) } : null;
  const review = { label: item.reviewStatus === "pending" ? "Отметить разобранным" : "Отметить неразобранным",
    run: () => onPatch({ reviewStatus: item.reviewStatus === "pending" ? "reviewed" : "pending" }), disabled: busy };
  const archive = { label: item.archivedAt ? "Восстановить" : "Архивировать",
    run: () => onPatch({ archived: !item.archivedAt }), disabled: busy };
  const edit = { label: "Изменить", run: () => onDialog({ type: "edit", item }) };
  const remove = { label: "Удалить", run: () => onDialog({ type: "delete", item }) };
  const retry = { label: "Повторить получение превью", run: onRetry, disabled: busy };
  const useWebsiteTitle = { label: "Использовать заголовок сайта",
    run: () => onPatch({ useWebsiteTitle: true }), disabled: busy };
  const menuActions = [
    ...(pageAction && item.url ? [pageAction] : []), edit,
    ...(item.canUseWebsiteTitle ? [useWebsiteTitle] : []), review, archive,
    ...(canRetryMetadata ? [retry] : []), remove,
  ];
  return <article className="notebook-saved-material min-w-0 space-y-4">
    <div className="space-y-2">
      <h2 id="saved-material-title" ref={heading} tabIndex={-1} data-expanded={expanded} className="notebook-saved-heading break-words text-2xl font-semibold tracking-tight outline-none">{title}</h2>
      {canExpand && <Button variant="ghost" className="notebook-saved-mobile min-h-11 px-2" aria-controls="saved-material-title" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? "Свернуть заголовок" : "Показать весь заголовок"}
      </Button>}
      <SavedFacts item={item}/>
    </div>
    <div className="notebook-saved-material-tags"><SavedTags item={item} onTag={onTag}/></div>
    <div className="notebook-saved-actions flex flex-wrap items-center gap-2">
      {item.url && <a className={cn(buttonVariants({ variant: canSaveArticle ? "outline" : "default" }), "notebook-saved-source min-h-11")} href={item.url} target="_blank" rel="noopener noreferrer">{canSaveArticle && usableArticle ? "Открыть оригинал" : "Открыть источник"} <ArrowUpRight size={16}/></a>}
      {pageAction && <Button variant="outline" className={cn("min-h-11", item.url && "notebook-saved-desktop")} onClick={pageAction.run}>{pageAction.label}</Button>}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="outline" className="notebook-saved-mobile size-11 px-0" aria-label="Действия с материалом"><Ellipsis size={20}/></Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="z-[80] max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-popover p-1.5 text-sm text-popover-foreground shadow-xl">
            {menuActions.map(action => <DropdownMenu.Item key={action.label} disabled={"disabled" in action && action.disabled === true} onSelect={action.run} className={cn(
              "flex min-h-11 items-center rounded-lg px-3 py-1 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent",
              action === remove && "text-destructive",
            )}>{action.label}</DropdownMenu.Item>)}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
    {item.url && (savedLabel || metadataLabel) && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <p role="status" className="flex flex-wrap gap-x-3 gap-y-1">
        {savedLabel && <span className="font-medium text-foreground">{savedLabel}</span>}
        {metadataLabel && <span>{metadataLabel}</span>}
      </p>
      {canRetryMetadata && <Button variant="ghost" className="notebook-saved-desktop min-h-11" disabled={busy} onClick={onRetry}>{retry.label}</Button>}
    </div>}
    {readsArticle && <SavedArticleControls reader={reader} canSave={canSaveArticle} onDiscarded={onArticleDiscarded}/>}
    {article?.browserPlaceholder && <p role="status" className="text-sm text-muted-foreground">Вместо материала сохранена страница обновления браузера.</p>}
    {preview && <DetailPreview key={`${preview}:${item.updatedAt}`} source={preview}/>}
    {article && <SavedArticleReader article={article} headingIndex={title === articleHeading.title ? articleHeading.index : -1}/>}
    {!usableArticle && item.metadata.description && <p className="whitespace-pre-wrap break-words text-muted-foreground">{item.metadata.description}</p>}
    {item.text && <p className="whitespace-pre-wrap break-words">{item.text}</p>}
    {item.attachments.length > 0 && <ul className="space-y-2" aria-label="Вложения">
      {item.attachments.map(file => <li key={file.id} className="min-w-0">
        {file.mimeType.startsWith("image/") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt={file.originalName} loading="lazy" decoding="async" className="mb-2 max-h-72 max-w-full rounded-xl object-contain"/>
        )}
        <a href={`${file.url}?download=1`} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm hover:bg-accent">
          <FileText size={16} className="shrink-0"/><span className="min-w-0 break-all">{file.originalName}{file.mimeType === "application/pdf" ? " · PDF" : ""}</span>
        </a>
      </li>)}
    </ul>}
    <div className="notebook-saved-desktop flex flex-wrap gap-1 border-t border-border/60 pt-3">
      <Button variant="ghost" className="min-h-11" onClick={edit.run}>{edit.label}</Button>
      {item.canUseWebsiteTitle && <Button variant="ghost" className="min-h-11" disabled={busy} onClick={useWebsiteTitle.run}>{useWebsiteTitle.label}</Button>}
      <Button variant="ghost" className="min-h-11" disabled={busy} onClick={review.run}>
        {review.label}
      </Button>
      <Button variant="ghost" className="min-h-11" disabled={busy} onClick={archive.run}>
        <Archive size={16}/>{archive.label}
      </Button>
      <Button variant="ghost" className="min-h-11 text-destructive" onClick={remove.run}>{remove.label}</Button>
    </div>
  </article>;
}

export function SavedItemsView({ selectedId, notebooks, onSelect, onBack, onPage, registerDismiss }: {
  selectedId: string | null; notebooks: Notebook[]; onSelect(id: string | null): void; onBack(): void; onPage(id: string): void;
  registerDismiss(dismiss: (() => void) | null): void;
}) {
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tag, setTag] = useState("");
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<SavedDialogAction | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!dialog) return;
    registerDismiss(() => {
      // Let the dialog enforce its own close guard while a mutation is pending.
      document.querySelector<HTMLButtonElement>('[data-saved-dialog-close]')?.click();
    });
    return () => registerDismiss(null);
  }, [dialog, registerDismiss]);
  const params = new URLSearchParams({
    archive: view === "archive" ? "archived" : "active",
    ...(view === "pending" ? { reviewStatus: "pending" } : {}),
    ...(debounced ? { q: debounced } : {}), ...(tag ? { tag } : {}),
  });
  const list = useSavedItems(params.toString(), version);
  const detail = useSavedItem(selectedId, version);
  const item = detail?.item ?? list.data?.items.find(entry => entry.id === selectedId);
  const reload = () => setVersion(value => value + 1);
  const selectTag = (next: string) => {
    setTag(previous => previous === next ? "" : next);
    if (selectedId) onSelect(null);
  };
  async function mutate(path: string, options: RequestInit) {
    if (!selectedId || workingId) return;
    setWorkingId(selectedId);
    setActionError(null);
    try { await api(path, options); reload(); }
    catch (error) { setActionError({ id: selectedId, message: savedError(error) }); }
    finally { setWorkingId(null); }
  }

  return <>
    <section className="notebook-saved-list min-h-0 min-w-0 overflow-y-auto bg-background px-3 pb-6 pt-3 md:px-5" data-detail-open={Boolean(selectedId)} aria-labelledby="saved-title">
      <header className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
        <Button variant="ghost" className="size-11 shrink-0 px-0 xl:w-8" aria-label="Назад из сохранённого" onClick={onBack}><ArrowLeft size={19}/></Button>
        <h1 id="saved-title" className="flex-1 whitespace-nowrap text-base font-semibold tracking-tight">{t("saved.title")}</h1>
        <Button className="min-h-11 px-3" onClick={() => setDialog({ type: "create" })}><Plus size={17}/>Добавить</Button>
      </header>
      <nav aria-label="Представления сохранённого" className="mb-3 flex flex-wrap gap-1">
        {views.map(option => <Button key={option.id} aria-pressed={view === option.id} variant={view === option.id ? "secondary" : "ghost"} className="min-h-11 px-2.5" onClick={() => {
          setView(option.id);
          if (selectedId) onSelect(null);
        }}>{option.name}</Button>)}
      </nav>
      <div className="mb-4 space-y-2">
        <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
          <Search size={17} className="shrink-0 text-muted-foreground"/>
          <input className="min-w-0 flex-1 bg-transparent outline-none" type="search" placeholder="Найти материал" aria-label="Поиск в сохранённом" maxLength={300} value={query} onChange={event => setQuery(event.target.value)}/>
        </label>
        {tag && <Button variant="secondary" className="min-h-11 max-w-full whitespace-normal break-all" onClick={() => setTag("")}>#{tag} · Сбросить фильтр</Button>}
      </div>
      {list.error ? <div role="alert" className="space-y-2 text-sm"><p>{list.error}</p><Button variant="outline" className="min-h-11" onClick={reload}>Повторить запрос</Button></div>
        : !list.data ? <p role="status" className="text-sm text-muted-foreground">Загружаем материалы…</p>
        : !list.data.items.length ? <p className="py-8 text-sm text-muted-foreground">{debounced || tag ? "Материалы по этому запросу не найдены." : view === "archive" ? "Архив пуст." : view === "pending" ? "Неразобранных материалов нет." : "Здесь будут ваши ссылки, заметки и файлы."}</p>
        : <ul className="space-y-3">{list.data.items.map(entry => <SavedCard key={entry.id} item={entry} selected={entry.id === selectedId} onSelect={() => onSelect(entry.id)} onTag={selectTag}/>)}</ul>}
      {list.moreError && <p role="alert" className="mt-3 text-sm text-destructive">{list.moreError}</p>}
      {list.data?.nextCursor && <Button variant="outline" className="mt-4 min-h-11 w-full" disabled={list.loadingMore || query.trim() !== debounced} onClick={() => void list.loadMore()}>{list.loadingMore ? "Загружаем…" : "Показать ещё"}</Button>}
    </section>
    <section className="notebook-saved-detail min-h-0 min-w-0 overflow-y-auto bg-background px-4 pb-8 pt-3 md:px-7" data-detail-open={Boolean(selectedId)} aria-label="Материал">
      {!selectedId ? <div className="grid min-h-48 place-content-center gap-2 text-center text-sm text-muted-foreground"><Bookmark size={24} className="mx-auto"/>Выберите материал</div> : <>
        <Button variant="ghost" className="mb-3 min-h-11 px-2" onClick={onBack}><ArrowLeft size={17}/>Назад</Button>
        <div className="mx-auto max-w-3xl">
          {actionError?.id === selectedId && <p role="alert" className="mb-4 text-sm text-destructive">{actionError.message}</p>}
          {detail?.error ? <p role="alert" className="text-sm">{detail.error}</p> : item ? <SavedDetail key={item.id} item={item} busy={workingId === item.id} onTag={selectTag} onDialog={setDialog} onPage={onPage}
            onPatch={patch => void mutate(savedItemEndpoint(item.id), jsonOptions("PATCH", patch))}
            onRetry={() => void mutate(`${savedItemEndpoint(item.id)}/metadata`, { method: "POST" })}
            onArticleDiscarded={reload}/> : <p role="status" className="text-sm text-muted-foreground">Загружаем материал…</p>}
        </div>
      </>}
    </section>
    {dialog && <SavedItemDialog action={dialog} notebooks={notebooks} onClose={() => setDialog(null)} onComplete={result => {
      setDialog(null);
      reload();
      if (dialog.type === "create" && result?.item) { setView("all"); setQuery(""); setTag(""); onSelect(result.item.id); }
      if (dialog.type === "delete") onSelect(null);
      if (result?.pageId) onPage(result.pageId);
    }}/>}
  </>;
}
