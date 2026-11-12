"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import type { SavedArticleBlocks } from "@/lib/saved-article-format";
import type { readSavedArticle } from "@/lib/services/saved-article-reader";
import { savedError, savedItemEndpoint } from "./saved-items-client";

type ReaderResult = Awaited<ReturnType<typeof readSavedArticle>>;
type Article = Omit<NonNullable<ReaderResult["article"]>, "extractedAt"> & { extractedAt: string };
type Job = Omit<NonNullable<ReaderResult["job"]>, "finishedAt"> & { finishedAt: string | null };
type ReaderState = { article: Article | null; job: Job | null };
type Block = SavedArticleBlocks[number];
type TextBlock = Exclude<Block, { type: "image" }>;
type ListItem = Extract<Block, { type: "listItem" }>;
const date = new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" });

export function useSavedArticle(id: string, enabled: boolean) {
  const [state, setState] = useState<ReaderState>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const endpoint = `${savedItemEndpoint(id)}/article`;
  const status = state?.job?.status;
  const pending = status === "queued" || status === "running" || status === "retry";
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void api<ReaderState>(endpoint, { signal: controller.signal }).then(setState).catch(() => {
      if (!controller.signal.aborted) setError("Не удалось проверить копию статьи");
    });
    return () => controller.abort();
  }, [enabled, endpoint]);
  useEffect(() => {
    if (!enabled || !pending) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        if (!document.hidden) setState(await api<ReaderState>(endpoint, { signal: controller.signal }));
      } catch { /* Keep the current copy available while polling. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 2500);
    }
    timer = setTimeout(() => void refresh(), 2500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [enabled, endpoint, pending]);

  async function request() {
    setSubmitting(true);
    setError("");
    try {
      const { job } = await api<{ job: Job }>(endpoint, { method: "POST" });
      setState(previous => ({ article: previous?.article ?? null, job }));
    } catch (error) { setError(savedError(error)); }
    finally { setSubmitting(false); }
  }
  return { state, error, submitting, pending, request };
}

export function SavedArticleControls({ reader }: { reader: ReturnType<typeof useSavedArticle> }) {
  const { state, error, submitting, pending, request } = reader;
  const article = state?.article;
  const status = state?.job?.status;
  const failed = status === "fallback" || status === "failed";
  const partial = article?.blocks.some(block => block.type === "image" && !article.images.some(image => image.key === block.key));
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
    <Button type="button" variant="outline" className="min-h-11" disabled={!state || submitting || pending} onClick={() => void request()}>
      {article ? "Обновить копию" : "Сохранить статью"}
    </Button>
    <span role="status">
      {error || (pending ? (article ? "Обновляем копию…" : "Сохраняем статью…")
        : failed ? (article ? "Обновление не удалось. Доступна предыдущая копия." : "Статью сохранить не удалось. Доступна закладка.")
        : article ? (partial ? "Часть изображений недоступна." : "")
        : state ? "Статья ещё не сохранена." : "Проверяем сохранённую копию…")}
    </span>
    {article && <span>Копия от <time dateTime={article.extractedAt}>{date.format(new Date(article.extractedAt))}</time></span>}
  </div>;
}

function Inline({ content }: { content: TextBlock["content"] }) {
  return content.map((part, index) => part.type === "text" ? <Fragment key={index}>{part.text}</Fragment>
    : <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>);
}

type ListNode = { item: ListItem; children: ListNode[] };
function listTree(items: ListItem[]) {
  const roots: ListNode[] = [];
  const parents: ListNode[] = [];
  for (const item of items) {
    const depth = Math.min(item.depth, parents.length);
    const node: ListNode = { item, children: [] };
    (depth ? parents[depth - 1].children : roots).push(node);
    parents.length = depth;
    parents.push(node);
  }
  return roots;
}

function ArticleList({ nodes }: { nodes: ListNode[] }) {
  const groups: { ordered: boolean; items: ListNode[] }[] = [];
  for (const node of nodes) {
    const previous = groups.at(-1);
    if (previous?.ordered === node.item.ordered) previous.items.push(node);
    else groups.push({ ordered: node.item.ordered, items: [node] });
  }
  return groups.map(({ ordered, items }, index) => {
    const List = ordered ? "ol" : "ul";
    return <List key={index}>{items.map(({ item, children }, position) =>
      <li key={position}><Inline content={item.content}/>{children.length > 0 && <ArticleList nodes={children}/>}</li>)}</List>;
  });
}

function ArticleImage({ src, alt }: { src: string | undefined; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <p className="notebook-article-missing-image" role="status">Изображение недоступно{alt ? ` · ${alt}` : ""}</p>;
  return <figure>
    {/* The server serves a private, normalized raster file. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)}/>
  </figure>;
}

export function savedArticleHeading(article: Article | null | undefined) {
  const index = article?.blocks.findIndex(block => block.type === "heading" && block.level === 1) ?? -1;
  const block = article?.blocks[index];
  return { index, title: block?.type === "heading" ? block.content.map(part => part.text).join("").trim() : "" };
}

export function SavedArticleReader({ article, headingIndex }: { article: Article; headingIndex: number }) {
  const images = new Map(article.images.map(image => [image.key, image.url]));
  const elements: ReactNode[] = [];
  const headings = ["h3", "h3", "h4", "h5", "h6", "h6"] as const;
  let list: ListItem[] = [];
  function flushList(key: number) {
    if (!list.length) return;
    elements.push(<ArticleList key={`list-${key}`} nodes={listTree(list)}/>);
    list = [];
  }
  for (const [index, block] of article.blocks.entries()) {
    if (index === headingIndex) continue;
    if (block.type === "listItem") { list.push(block); continue; }
    flushList(index);
    if (block.type === "image") elements.push(<ArticleImage key={`${index}-${article.extractedAt}`} src={images.get(block.key)} alt={block.alt}/>);
    else if (block.type === "paragraph") elements.push(<p key={index}><Inline content={block.content}/></p>);
    else if (block.type === "quote") elements.push(<blockquote key={index}><Inline content={block.content}/></blockquote>);
    else {
      const Heading = headings[block.level - 1] ?? "h3";
      elements.push(<Heading key={index}><Inline content={block.content}/></Heading>);
    }
  }
  flushList(article.blocks.length);
  return <section className="notebook-article-reader" aria-label="Сохранённая статья">{elements}</section>;
}
