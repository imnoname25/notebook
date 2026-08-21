"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Archive, ArchiveRestore, ArrowLeft, ArrowRight, Inbox, Loader2, Pin, PinOff, Plus, StickyNote, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/messages";
import { ACCENT_LABELS } from "@/lib/content-appearance";
import type { Notebook, PageDocument } from "./types";

export type QuickNote = {
  id: string; title: string; body: string; color: string; icon: string | null;
  isPinned: boolean; status: "INBOX" | "ARCHIVED" | "CONVERTED"; archivedAt: string | null;
  createdAt: string; updatedAt: string;
  tags: { tag: { name: string; normalized: string } }[];
};

const COLORS = ["amber", "orange", "green", "blue", "violet", "pink", "neutral"] as const;
const orderNotes = (items: QuickNote[]) => [...items].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

export function QuickCapture({ open, initialTitle = "", initialBody = "", onOpenChange, onSaved, onError }: {
  open: boolean; initialTitle?: string; initialBody?: string; onOpenChange(open: boolean): void; onSaved(note: QuickNote): void; onError(error: unknown): void;
}) {
  const [body, setBody] = useState(initialBody);
  const [title, setTitle] = useState(initialTitle);
  const [color, setColor] = useState<(typeof COLORS)[number]>("amber");
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      const { note } = await api<{ note: QuickNote }>("/api/quick-notes", jsonOptions("POST", { body: body.trim(), title: title.trim(), color, icon: "📝" }));
      if (isPinned) await api(`/api/quick-notes/${note.id}`, jsonOptions("PATCH", { isPinned: true }));
      setBody(""); setTitle(""); setColor("amber"); setIsPinned(false);
      onOpenChange(false); onSaved({ ...note, isPinned });
    } catch (error) { onError(error); } finally { setSaving(false); }
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
    <Dialog.Content aria-describedby={undefined} className="notebook-mobile-sheet fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-card p-4 shadow-2xl ring-1 ring-border sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(500px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-5">
      <header className="mb-4 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-amber-400/15 text-amber-600 dark:text-amber-300"><StickyNote size={20}/></span><div className="min-w-0 flex-1"><Dialog.Title className="font-semibold">{t("quickNotes.captureTitle")}</Dialog.Title><p className="text-sm text-muted-foreground">{t("quickNotes.subtitle")}</p></div><Dialog.Close className="flex size-11 items-center justify-center rounded-lg hover:bg-accent" aria-label={t("common.close")}><X size={19}/></Dialog.Close></header>
      <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder={t("quickNotes.optionalTitle")} className="mb-2 h-11 w-full rounded-lg bg-muted/55 px-3 text-sm font-medium outline-none ring-1 ring-border/50 focus:ring-ring" />
      <textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void save(); }} rows={5} maxLength={10_000} placeholder={t("quickNotes.placeholder")} className="w-full resize-none rounded-xl bg-muted/55 p-3 text-base leading-6 outline-none ring-1 ring-border/50 focus:ring-ring" />
      <div className="mt-3 flex flex-wrap items-center gap-2"><div className="flex gap-1">{COLORS.map((item) => <button key={item} data-color={item} className={cn("quick-note-swatch size-8 rounded-full ring-offset-2", color === item && "ring-2 ring-foreground/60")} aria-label={ACCENT_LABELS[item]} title={ACCENT_LABELS[item]} onClick={() => setColor(item)}/>)}</div><button type="button" className={cn("ml-auto flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-accent", isPinned && "bg-accent")} onClick={() => setIsPinned((value) => !value)}><Pin size={16}/>{t("quickNotes.pin")}</button><Button className="min-h-11" disabled={!body.trim() || saving} onClick={() => void save()}>{saving ? <Loader2 className="animate-spin"/> : <Plus/>}{t("quickNotes.saveInbox")}</Button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function InboxView({ notebooks, revision, onBack, onConverted, onTag, onError }: {
  notebooks: Notebook[]; revision: number; onBack(): void; onConverted(page: PageDocument): void; onTag(tag: string): void; onError(error: unknown): void;
}) {
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [archived, setArchived] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const [destinationFor, setDestinationFor] = useState<string | null>(null);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const sections = notebooks.flatMap((notebook) => notebook.sections.filter((section) => !section.parentId).map((section) => ({ id: section.id, label: `${notebook.title} / ${section.title}` })));
  useEffect(() => {
    const controller = new AbortController();
    void api<{ notes: QuickNote[] }>(`/api/quick-notes?archived=${archived ? "1" : "0"}`, { signal: controller.signal })
      .then(({ notes: result }) => { setNotes(orderNotes(result)); setLoadedKey(archived ? "archived" : "active"); })
      .catch((error: Error) => { if (error.name !== "AbortError") onError(error); })
    return () => controller.abort();
  }, [archived, onError, revision]);
  async function patch(id: string, input: Record<string, unknown>) {
    const previous = notes;
    try {
      const { note } = await api<{ note: QuickNote }>(`/api/quick-notes/${id}`, jsonOptions("PATCH", input));
      setNotes((current) => orderNotes(current.map((item) => item.id === id ? note : item).filter((item) => archived ? item.status !== "INBOX" : item.status === "INBOX")));
    } catch (error) { setNotes(previous); onError(error); }
  }
  function scheduleTextSave(id: string, input: { title?: string; body?: string }) {
    setNotes((current) => current.map((note) => note.id === id ? { ...note, ...input } : note));
    const previous = saveTimers.current.get(id); if (previous) clearTimeout(previous);
    saveTimers.current.set(id, setTimeout(() => { saveTimers.current.delete(id); void api(`/api/quick-notes/${id}`, jsonOptions("PATCH", input)).catch(onError); }, 650));
  }
  function flushTextSave(id: string, input: { title?: string; body?: string }) {
    const timer = saveTimers.current.get(id); if (timer) clearTimeout(timer); saveTimers.current.delete(id); void patch(id, input);
  }
  async function remove(note: QuickNote) {
    if (!window.confirm(t("quickNotes.deleteConfirm"))) return;
    try { await api(`/api/quick-notes/${note.id}`, jsonOptions("DELETE")); setNotes((current) => current.filter((item) => item.id !== note.id)); } catch (error) { onError(error); }
  }
  async function convert(note: QuickNote, sectionId: string) {
    try {
      const { page } = await api<{ page: PageDocument }>(`/api/quick-notes/${note.id}/convert`, jsonOptions("POST", { sectionId }));
      setNotes((current) => current.filter((item) => item.id !== note.id)); setDestinationFor(null); onConverted(page);
    } catch (error) { onError(error); }
  }
  const pinned = notes.filter((note) => note.isPinned); const regular = notes.filter((note) => !note.isPinned);
  const loading = loadedKey !== (archived ? "archived" : "active");
  const shared = { archived, destinationFor, sections, setDestinationFor, patch, scheduleTextSave, flushTextSave, remove, convert, onTag };
  return <main className="col-span-full flex min-h-0 min-w-0 flex-col bg-background">
    <header className="flex min-h-16 items-center gap-3 border-b border-border/60 px-3 sm:px-5"><Button variant="ghost" className="h-11 px-2 md:hidden" onClick={onBack}><ArrowLeft size={20}/></Button><span className="flex size-10 items-center justify-center rounded-xl bg-amber-400/15 text-amber-600 dark:text-amber-300"><Inbox size={20}/></span><div className="min-w-0 flex-1"><h1 className="text-lg font-semibold">{t("quickNotes.inbox")}</h1><p className="text-sm text-muted-foreground">{t("quickNotes.inboxSubtitle")}</p></div><button className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setArchived((value) => !value)}>{archived ? t("quickNotes.active") : t("quickNotes.archive")}</button></header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6"><div className="mx-auto max-w-6xl">
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground"/></div> : notes.length === 0 ? <div className="py-16 text-center"><StickyNote className="mx-auto mb-3 text-muted-foreground/35" size={34}/><h2 className="font-semibold">{archived ? t("quickNotes.archiveEmpty") : t("quickNotes.inboxEmpty")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("quickNotes.inboxEmptyHint")}</p></div> : <>{pinned.length > 0 && <NoteGroup title={t("quickNotes.pinned")} notes={pinned} {...shared}/>}<NoteGroup title={pinned.length ? t("quickNotes.other") : ""} notes={regular} {...shared}/></>}
    </div></div>
  </main>;
}

type NoteGroupProps = {
  title?: string; notes: QuickNote[]; archived: boolean; destinationFor: string | null; sections: { id: string; label: string }[];
  setDestinationFor(value: string | null): void; patch(id: string, input: Record<string, unknown>): Promise<void>;
  scheduleTextSave(id: string, input: { title?: string; body?: string }): void; flushTextSave(id: string, input: { title?: string; body?: string }): void;
  remove(note: QuickNote): Promise<void>; convert(note: QuickNote, sectionId: string): Promise<void>; onTag(tag: string): void;
};
function NoteGroup(props: NoteGroupProps) {
  if (!props.notes.length) return null;
  return <section className="mb-7">{props.title && <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{props.title}</h2>}<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{props.notes.map((note) => <QuickNoteCard key={note.id} note={note} {...props}/>)}</div></section>;
}
function QuickNoteCard({ note, archived, destinationFor, sections, setDestinationFor, patch, scheduleTextSave, flushTextSave, remove, convert, onTag }: NoteGroupProps & { note: QuickNote }) {
  const previewTags = note.tags.slice(0, 3);
  return <article data-quick-note-color={note.color} className="quick-note-card group relative min-w-0 rounded-xl p-4 shadow-sm ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md dark:ring-white/10">
    <div className="mb-2 flex items-center gap-2"><span className="text-xl">{note.icon ?? "📝"}</span><input value={note.title} onChange={(event) => scheduleTextSave(note.id, { title: event.target.value })} onBlur={(event) => flushTextSave(note.id, { title: event.target.value })} placeholder={t("quickNotes.noteTitle")} className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-foreground/50"/><button className="flex size-10 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void patch(note.id, { isPinned: !note.isPinned })} aria-label={note.isPinned ? t("quickNotes.unpin") : t("quickNotes.pin")}>{note.isPinned ? <PinOff size={16}/> : <Pin size={16}/>}</button></div>
    <textarea value={note.body} onChange={(event) => scheduleTextSave(note.id, { body: event.target.value })} onBlur={(event) => flushTextSave(note.id, { body: event.target.value })} rows={6} className="w-full resize-none bg-transparent text-[15px] leading-6 outline-none"/>
    {previewTags.length > 0 && <div className="mb-2 flex flex-wrap gap-1">{previewTags.map(({ tag }) => <button key={tag.normalized} className="notebook-tag-chip" onClick={() => onTag(tag.normalized)}>#{tag.name}</button>)}{note.tags.length > 3 && <span className="notebook-tag-chip">+{note.tags.length - 3}</span>}</div>}
    {note.status === "CONVERTED" && <p className="mt-2 text-xs font-medium text-muted-foreground">{t("quickNotes.converted")}</p>}
    <div className="mt-2 flex items-center gap-1"><div className="flex gap-1">{COLORS.map((color) => <button key={color} data-color={color} className={cn("quick-note-swatch size-6 rounded-full ring-offset-2", note.color === color && "ring-2 ring-foreground/60")} aria-label={ACCENT_LABELS[color]} onClick={() => void patch(note.id, { color })}/>)}</div><span className="ml-auto flex">{note.status !== "CONVERTED" && <button className="flex size-10 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void patch(note.id, { archived: !archived })} aria-label={archived ? t("quickNotes.restore") : t("quickNotes.archiveAction")}>{archived ? <ArchiveRestore size={16}/> : <Archive size={16}/>}</button>}<button className="flex size-10 items-center justify-center rounded-lg text-destructive hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void remove(note)} aria-label={t("quickNotes.delete")}><Trash2 size={16}/></button>{!archived && <button className="flex size-10 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10" onClick={() => setDestinationFor(destinationFor === note.id ? null : note.id)} aria-label={t("quickNotes.move")}><ArrowRight size={16}/></button>}</span></div>
    {destinationFor === note.id && <div className="mt-2 border-t border-black/10 pt-2 dark:border-white/10"><select defaultValue="" className="min-h-11 w-full rounded-lg bg-background/75 px-2 text-sm" onChange={(event) => { if (event.target.value) void convert(note, event.target.value); }}><option value="" disabled>{sections.length ? t("quickNotes.chooseSection") : t("quickNotes.noSections")}</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}</select></div>}
  </article>;
}
