"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ListTree, X } from "lucide-react";
import { t } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import type { PageOutlineItem } from "@/lib/page-outline";

export function OutlineList({ items, onSelect, className }: { items: PageOutlineItem[]; onSelect(id: string): void; className?: string }) {
  return <nav aria-label={t("outline.title")} className={cn("space-y-0.5", className)}>{items.length ? items.map((item) => <button key={item.id} type="button" title={item.title} onClick={() => onSelect(item.id)} className="block min-h-9 w-full truncate rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ paddingLeft: 8 + (item.level - 1) * 14 }}>{item.title}</button>) : <p className="px-2 py-6 text-sm text-muted-foreground">{t("outline.empty")}</p>}</nav>;
}

export function MobileOutlineSheet({ open, items, onOpenChange, onSelect }: { open: boolean; items: PageOutlineItem[]; onOpenChange(open: boolean): void; onSelect(id: string): void }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/><Dialog.Content aria-describedby={undefined} className="notebook-mobile-sheet fixed bottom-0 left-0 z-50 max-h-[75dvh] w-full overflow-y-auto rounded-t-xl bg-card p-4 shadow-2xl md:hidden"><header className="mb-3 flex min-h-12 items-center gap-3"><ListTree size={20}/><Dialog.Title className="font-semibold">{t("outline.title")}</Dialog.Title><Dialog.Close className="ml-auto flex size-11 items-center justify-center rounded-md hover:bg-accent" aria-label={t("common.close")}><X size={19}/></Dialog.Close></header><OutlineList items={items} onSelect={onSelect}/></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
