"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Archive, ArchiveRestore, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Ellipsis, GripVertical, Loader2, Pencil, Pin, PinOff, Plus, StickyNote, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n/messages";
import { ACCENT_LABELS } from "@/lib/content-appearance";
import { SortableItem, SortableList, type SortableRenderState } from "./sortable";
import type { Notebook, PageDocument } from "./types";

export type QuickNote = {
  id: string; title: string; body: string; color: string; icon: string | null;
  isPinned: boolean; sortOrder: number; status: "INBOX" | "ARCHIVED" | "CONVERTED"; archivedAt: string | null;
  createdAt: string; updatedAt: string;
  tags: { tag: { name: string; normalized: string } }[];
};

const COLORS = ["amber", "orange", "pink", "blue", "green", "violet", "neutral"] as const;
const orderNotes = (items: QuickNote[]) => [...items].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

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
      const saved = isPinned ? (await api<{ note: QuickNote }>(`/api/quick-notes/${note.id}`, jsonOptions("PATCH", { isPinned: true }))).note : note;
      setBody(""); setTitle(""); setColor("amber"); setIsPinned(false);
      onOpenChange(false); onSaved(saved);
    } catch (error) { onError(error); } finally { setSaving(false); }
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"/>
    <Dialog.Content aria-describedby={undefined} className="notebook-mobile-sheet fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-card p-4 shadow-2xl ring-1 ring-border sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(500px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-5">
      <header className="mb-4 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-amber-400/15 text-amber-600 dark:text-amber-300"><StickyNote size={20}/></span><div className="min-w-0 flex-1"><Dialog.Title className="font-semibold">{t("quickNotes.captureTitle")}</Dialog.Title><p className="text-sm text-muted-foreground">{t("quickNotes.subtitle")}</p></div><Dialog.Close className="flex size-11 items-center justify-center rounded-lg hover:bg-accent" aria-label={t("common.close")}><X size={19}/></Dialog.Close></header>
      <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder={t("quickNotes.optionalTitle")} className="mb-2 h-11 w-full rounded-lg bg-muted/55 px-3 text-sm font-medium outline-none ring-1 ring-border/50 focus:ring-ring"/>
      <textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void save(); }} rows={5} maxLength={10_000} placeholder={t("quickNotes.placeholder")} className="w-full resize-none rounded-xl bg-muted/55 p-3 text-base leading-6 outline-none ring-1 ring-border/50 focus:ring-ring"/>
      <div className="mt-3 flex flex-wrap items-center gap-2"><div className="flex gap-1">{COLORS.map((item) => <button key={item} data-color={item} className={cn("quick-note-swatch size-8 rounded-full ring-offset-2", color === item && "ring-2 ring-foreground/60")} aria-label={ACCENT_LABELS[item]} title={ACCENT_LABELS[item]} onClick={() => setColor(item)}/>)}</div><button type="button" className={cn("ml-auto flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-accent", isPinned && "bg-accent")} onClick={() => setIsPinned((value) => !value)}><Pin size={16}/>{t("quickNotes.pin")}</button><Button className="min-h-11" disabled={!body.trim() || saving} onClick={() => void save()}>{saving ? <Loader2 className="animate-spin"/> : <Plus/>}{t("quickNotes.saveInbox")}</Button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function StickerBoard({ notebooks, revision, onBack, onConverted, onTag, onError }: {
  notebooks: Notebook[]; revision: number; onBack(): void; onConverted(page: PageDocument): void; onTag(tag: string): void; onError(error: unknown): void;
}) {
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [archived, setArchived] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const [destinationFor, setDestinationFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const sections = notebooks.flatMap((notebook) => notebook.sections.filter((section) => !section.parentId).map((section) => ({ id: section.id, label: `${notebook.title} / ${section.title}` })));

  useEffect(() => {
    const controller = new AbortController();
    void api<{ notes: QuickNote[] }>(`/api/quick-notes?archived=${archived ? "1" : "0"}`, { signal: controller.signal })
      .then(({ notes: result }) => { setNotes(orderNotes(result)); setLoadedKey(archived ? "archived" : "active"); })
      .catch((error: Error) => { if (error.name !== "AbortError") onError(error); });
    return () => controller.abort();
  }, [archived, onError, revision]);

  useEffect(() => {
    const overlayOpen = Boolean(menuFor || destinationFor);
    window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: overlayOpen }));
    if (!overlayOpen) return;
    const close = () => {
      if (menuFor) setMenuFor(null);
      else setDestinationFor(null);
    };
    window.addEventListener("notebook:close-editor-overlay", close);
    return () => {
      window.removeEventListener("notebook:close-editor-overlay", close);
      window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: false }));
    };
  }, [destinationFor, menuFor]);

  async function createSticker() {
    if (creating || archived) return;
    setCreating(true);
    try {
      const { note } = await api<{ note: QuickNote }>("/api/quick-notes", jsonOptions("POST", { title: "", body: "", color: "amber", icon: "📝" }));
      setNotes((current) => orderNotes([...current, note]));
      setFocusId(note.id);
    } catch (error) { onError(error); } finally { setCreating(false); }
  }
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
    saveTimers.current.set(id, setTimeout(() => { saveTimers.current.delete(id); void patch(id, input); }, 650));
  }
  function flushTextSave(id: string, input: { title?: string; body?: string }) {
    const timer = saveTimers.current.get(id); if (timer) clearTimeout(timer); saveTimers.current.delete(id); void patch(id, input);
  }
  async function duplicate(note: QuickNote) {
    try {
      const { note: copy } = await api<{ note: QuickNote }>(`/api/quick-notes/${note.id}/duplicate`, jsonOptions("POST"));
      setNotes((current) => orderNotes([...current, copy])); setFocusId(copy.id);
    } catch (error) { onError(error); }
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
  async function reorderGroup(ids: string[], pinnedGroup: boolean) {
    const previous = notes;
    const other = orderNotes(notes).filter((note) => note.isPinned !== pinnedGroup).map((note) => note.id);
    const orderedIds = pinnedGroup ? [...ids, ...other] : [...other, ...ids];
    const positions = new Map(orderedIds.map((id, index) => [id, index]));
    setNotes((current) => orderNotes(current.map((note) => ({ ...note, sortOrder: positions.get(note.id) ?? note.sortOrder }))));
    try { await api("/api/quick-notes/reorder", jsonOptions("PUT", { ids: orderedIds })); }
    catch (error) { setNotes(previous); onError(error); }
  }
  function moveWithin(note: QuickNote, direction: -1 | 1) {
    const group = orderNotes(notes).filter((item) => item.isPinned === note.isPinned);
    const index = group.findIndex((item) => item.id === note.id); const target = index + direction;
    if (index < 0 || target < 0 || target >= group.length) return;
    const ids = group.map((item) => item.id); [ids[index], ids[target]] = [ids[target]!, ids[index]!]; void reorderGroup(ids, note.isPinned);
  }

  const pinned = notes.filter((note) => note.isPinned); const regular = notes.filter((note) => !note.isPinned);
  const loading = loadedKey !== (archived ? "archived" : "active");
  const shared = { archived, destinationFor, menuFor, sections, focusId, setFocusId, setDestinationFor, setMenuFor, patch, scheduleTextSave, flushTextSave, duplicate, remove, convert, moveWithin, onTag };
  return <main data-testid="sticker-board" className="sticker-board-shell min-h-0 min-w-0 overflow-y-auto bg-background md:col-span-2">
    <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-border/60 bg-background/92 px-3 backdrop-blur sm:px-5"><Button variant="ghost" className="h-11 px-2 md:hidden" onClick={onBack}><ArrowLeft size={20}/></Button><span className="flex size-10 items-center justify-center rounded-xl bg-amber-400/15 text-amber-700 dark:text-amber-300"><StickyNote size={20}/></span><div className="min-w-0 flex-1"><h1 className="text-lg font-semibold">{t("quickNotes.inbox")}</h1><p className="hidden text-sm text-muted-foreground sm:block">{t("quickNotes.inboxSubtitle")}</p></div><button className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setArchived((value) => !value)}>{archived ? t("quickNotes.active") : t("quickNotes.archive")}</button>{!archived && <Button className="hidden min-h-11 sm:inline-flex" onClick={() => void createSticker()} disabled={creating}>{creating ? <Loader2 className="animate-spin"/> : <Plus/>}{t("quickNotes.newSticker")}</Button>}</header>
    <div className="p-4 md:p-6">
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-muted-foreground"/></div> : notes.length === 0 ? <div className="mx-auto max-w-md py-16 text-center"><StickyNote className="mx-auto mb-3 text-muted-foreground/35" size={38}/><h2 className="font-semibold">{archived ? t("quickNotes.archiveEmpty") : t("quickNotes.inboxEmpty")}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{t("quickNotes.inboxEmptyHint")}</p>{!archived && <Button className="mt-5 min-h-11" onClick={() => void createSticker()}><Plus/>{t("quickNotes.newSticker")}</Button>}</div> : <>{pinned.length > 0 && <NoteGroup title={t("quickNotes.pinned")} notes={pinned} onReorder={(ids) => void reorderGroup(ids, true)} {...shared}/>}<NoteGroup title={pinned.length ? t("quickNotes.other") : ""} notes={regular} onReorder={(ids) => void reorderGroup(ids, false)} {...shared}/></>}
    </div>
    {!archived && <button type="button" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-4 z-20 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden" aria-label={t("quickNotes.newSticker")} onClick={() => void createSticker()}><Plus size={24}/></button>}
  </main>;
}

type NoteGroupProps = {
  title?: string; notes: QuickNote[]; archived: boolean; destinationFor: string | null; menuFor: string | null; focusId: string | null; sections: { id: string; label: string }[];
  setFocusId(value: string | null): void; setDestinationFor(value: string | null): void; setMenuFor(value: string | null): void; patch(id: string, input: Record<string, unknown>): Promise<void>;
  scheduleTextSave(id: string, input: { title?: string; body?: string }): void; flushTextSave(id: string, input: { title?: string; body?: string }): void;
  duplicate(note: QuickNote): Promise<void>; remove(note: QuickNote): Promise<void>; convert(note: QuickNote, sectionId: string): Promise<void>; moveWithin(note: QuickNote, direction: -1 | 1): void; onTag(tag: string): void;
  onReorder(ids: string[]): void;
};
function NoteGroup(props: NoteGroupProps) {
  if (!props.notes.length) return null;
  return <section className="mb-8">{props.title && <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{props.title}</h2>}<SortableList ids={props.notes.map((note) => note.id)} onReorder={props.onReorder} strategy="rect"><div className="sticker-board-grid">{props.notes.map((note) => <SortableItem id={note.id} key={note.id}>{({ setNodeRef, style, attributes, listeners, isDragging }) => <QuickNoteCard note={note} setNodeRef={setNodeRef} sortableStyle={style} dragAttributes={attributes} dragListeners={listeners} isDragging={isDragging} {...props}/>}</SortableItem>)}</div></SortableList></section>;
}
type DragProps = Pick<SortableRenderState, "setNodeRef" | "attributes" | "listeners" | "isDragging"> & { sortableStyle: SortableRenderState["style"]; dragAttributes: SortableRenderState["attributes"]; dragListeners: SortableRenderState["listeners"] };
function QuickNoteCard({ note, setNodeRef, sortableStyle, dragAttributes, dragListeners, isDragging, archived, destinationFor, menuFor, focusId, sections, setFocusId, setDestinationFor, setMenuFor, patch, scheduleTextSave, flushTextSave, duplicate, remove, convert, moveWithin, onTag }: NoteGroupProps & { note: QuickNote } & Omit<DragProps, "attributes" | "listeners">) {
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (focusId !== note.id) return;
    bodyRef.current?.focus();
    const frame = window.requestAnimationFrame(() => setFocusId(null));
    return () => window.cancelAnimationFrame(frame);
  }, [focusId, note.id, setFocusId]);
  const previewTags = note.tags.slice(0, 3);
  return <article ref={setNodeRef} style={sortableStyle} data-testid="sticker-card" data-sticker-id={note.id} data-quick-note-color={note.color} data-dragging={isDragging ? "true" : "false"} className="quick-note-card group relative min-w-0 rounded-xl p-4 shadow-sm ring-1 ring-black/5 transition dark:ring-white/10">
    <div className="mb-2 flex items-center gap-2">{!archived && <button className="notebook-no-touch hidden size-8 cursor-grab touch-none items-center justify-center rounded-md text-foreground/45 hover:bg-black/5 hover:text-foreground md:flex" aria-label={`${t("quickNotes.reorder")} ${note.title || note.body.slice(0, 20)}`} {...dragAttributes} {...dragListeners}><GripVertical size={17}/></button>}<span className="text-xl">{note.icon ?? "📝"}</span><input value={note.title} onChange={(event) => scheduleTextSave(note.id, { title: event.target.value })} onBlur={(event) => flushTextSave(note.id, { title: event.target.value })} placeholder={t("quickNotes.noteTitle")} className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:text-foreground/50"/><StickerMenu note={note} archived={archived} open={menuFor === note.id} onOpenChange={(open) => setMenuFor(open ? note.id : null)} onEdit={() => { bodyRef.current?.focus(); }} onPin={() => void patch(note.id, { isPinned: !note.isPinned })} onColor={(color) => void patch(note.id, { color })} onMove={() => setDestinationFor(destinationFor === note.id ? null : note.id)} onArchive={() => void patch(note.id, { archived: !archived })} onDuplicate={() => void duplicate(note)} onDelete={() => void remove(note)} onUp={() => moveWithin(note, -1)} onDown={() => moveWithin(note, 1)}/></div>
    <textarea ref={bodyRef} value={note.body} onChange={(event) => scheduleTextSave(note.id, { body: event.target.value })} onBlur={(event) => flushTextSave(note.id, { body: event.target.value })} rows={Math.max(4, Math.min(10, note.body.split("\n").length + 3))} maxLength={10_000} placeholder={t("quickNotes.placeholder")} className="w-full resize-none bg-transparent text-[15px] leading-6 outline-none"/>
    {previewTags.length > 0 && <div className="mb-2 flex flex-wrap gap-1">{previewTags.map(({ tag }) => <button key={tag.normalized} className="notebook-tag-chip" onClick={() => onTag(tag.normalized)}>#{tag.name}</button>)}{note.tags.length > 3 && <span className="notebook-tag-chip">+{note.tags.length - 3}</span>}</div>}
    {note.status === "CONVERTED" && <p className="mt-2 text-xs font-medium text-muted-foreground">{t("quickNotes.converted")}</p>}
    <footer className="mt-3 flex items-center gap-2 text-xs text-foreground/55">{note.isPinned && <span className="flex items-center gap-1 font-medium"><Pin size={13}/>{t("quickNotes.pinned")}</span>}<time className="ml-auto" dateTime={note.updatedAt}>{new Date(note.updatedAt).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></footer>
    {destinationFor === note.id && <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10"><select autoFocus defaultValue="" className="min-h-11 w-full rounded-lg bg-background/75 px-2 text-sm" onChange={(event) => { if (event.target.value) void convert(note, event.target.value); }}><option value="" disabled>{sections.length ? t("quickNotes.chooseSection") : t("quickNotes.noSections")}</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}</select></div>}
  </article>;
}

function StickerMenu({ note, archived, open, onOpenChange, onEdit, onPin, onColor, onMove, onArchive, onDuplicate, onDelete, onUp, onDown }: { note: QuickNote; archived: boolean; open: boolean; onOpenChange(open: boolean): void; onEdit(): void; onPin(): void; onColor(color: string): void; onMove(): void; onArchive(): void; onDuplicate(): void; onDelete(): void; onUp(): void; onDown(): void }) {
  return <DropdownMenu.Root open={open} onOpenChange={onOpenChange}><DropdownMenu.Trigger asChild><button className="flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10" aria-label={t("quickNotes.actions")}><Ellipsis size={18}/></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-[80] min-w-56 rounded-xl border border-border bg-popover p-1.5 text-sm shadow-xl">
    <MenuItem icon={<Pencil size={16}/>} onSelect={onEdit}>{t("quickNotes.edit")}</MenuItem>
    {!archived && <MenuItem icon={note.isPinned ? <PinOff size={16}/> : <Pin size={16}/>} onSelect={onPin}>{note.isPinned ? t("quickNotes.unpin") : t("quickNotes.pin")}</MenuItem>}
    <div className="my-1 flex gap-1 border-y border-border/60 px-2 py-2">{COLORS.map((color) => <button key={color} data-color={color} className={cn("quick-note-swatch size-7 rounded-full", note.color === color && "ring-2 ring-foreground/60 ring-offset-2")} aria-label={ACCENT_LABELS[color]} onClick={() => onColor(color)}/>)}</div>
    {!archived && <MenuItem icon={<ArrowRight size={16}/>} onSelect={onMove}>{t("quickNotes.move")}</MenuItem>}
    <MenuItem icon={archived ? <ArchiveRestore size={16}/> : <Archive size={16}/>} onSelect={onArchive}>{archived ? t("quickNotes.restore") : t("quickNotes.archiveAction")}</MenuItem>
    {!archived && <MenuItem icon={<Copy size={16}/>} onSelect={onDuplicate}>{t("quickNotes.duplicate")}</MenuItem>}
    {!archived && <div className="grid grid-cols-2 gap-1 md:hidden"><MenuItem icon={<ArrowUp size={16}/>} onSelect={onUp}>{t("quickNotes.higher")}</MenuItem><MenuItem icon={<ArrowDown size={16}/>} onSelect={onDown}>{t("quickNotes.lower")}</MenuItem></div>}
    <DropdownMenu.Separator className="my-1 h-px bg-border"/><DropdownMenu.Item className="flex min-h-10 cursor-default items-center gap-2 rounded-lg px-2 text-destructive outline-none data-[highlighted]:bg-accent" onSelect={onDelete}><Trash2 size={16}/>{t("quickNotes.delete")}</DropdownMenu.Item>
  </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}
function MenuItem({ icon, children, onSelect }: { icon: ReactNode; children: ReactNode; onSelect(): void }) { return <DropdownMenu.Item className="flex min-h-10 cursor-default items-center gap-2 rounded-lg px-2 outline-none data-[highlighted]:bg-accent" onSelect={onSelect}>{icon}{children}</DropdownMenu.Item>; }
