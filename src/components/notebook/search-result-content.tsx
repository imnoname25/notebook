"use client";
import { Bookmark, FileText, Folder, StickyNote } from "lucide-react";
import { t } from "@/lib/i18n/messages";
import type { HighlightPart, SearchResult } from "@/lib/services/search-service";

export function SearchResultContent({ result, date = false }: { result: SearchResult; date?: boolean }) {
  const Icon = result.type === "savedItem" ? Bookmark : result.type === "quickNote" ? StickyNote : result.type === "page" ? FileText : Folder;
  const location = result.type === "savedItem" ? t("saved.title") : result.type === "quickNote" ? "Стикеры" : [result.notebookTitle, result.sectionTitle].filter(Boolean).join(" / ");
  return <><Icon size={17} className="mt-0.5 shrink-0 text-muted-foreground"/><span className="min-w-0 flex-1"><span className="block break-words font-medium"><Highlighted parts={result.titleParts}/></span><span className="mt-1 block truncate text-xs text-muted-foreground">{location}</span>{(result.snippetParts || result.snippet) && <span className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground"><Highlighted parts={result.snippetParts ?? [{ text: result.snippet ?? "", highlight: false }]}/></span>}{date && result.updatedAt && <time dateTime={result.updatedAt} className="mt-1 block text-[11px] text-muted-foreground">{new Date(result.updatedAt).toLocaleDateString("ru-RU")}</time>}</span></>;
}
function Highlighted({ parts }: { parts: HighlightPart[] }) { return <>{parts.map((part, i) => part.highlight ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}</>; }
