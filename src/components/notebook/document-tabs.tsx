"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Ellipsis, Pin, X } from "lucide-react";
import type { useDocumentTabs } from "./use-document-tabs";
import type { DocumentTab } from "@/lib/document-tabs";

type Controller = ReturnType<typeof useDocumentTabs>;
export function DocumentTabs({ controller, keyboardActive = true, paneId, onMove, onReceive }: { controller: Controller; keyboardActive?: boolean; paneId?: string; onMove?(id: string): void; onReceive?(id: string): void }) {
  const { tabs, activePageId, titles } = controller;
  const [sheet, setSheet] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const active = tabs.find(t => t.pageId === activePageId);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("notebook:tabs-overlay", { detail: sheet }));
    const close = () => setSheet(false);
    window.addEventListener("notebook:close-tabs-overlay", close);
    return () => { window.removeEventListener("notebook:close-tabs-overlay", close);window.dispatchEvent(new CustomEvent("notebook:tabs-overlay", { detail: false })); };
  }, [sheet]);
  const label = (id: string) => typeof titles[id] === "string" && titles[id] ? titles[id] : "Документ";
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePageId]);
  useEffect(() => {
    if (!keyboardActive) return;
    const keys = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented || !tabs.length || (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]'))) return;
      const index = Math.max(0, tabs.findIndex(t => t.pageId === activePageId));
      let target: DocumentTab | undefined;
      if (event.key === "Tab") target = tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
      else if (/^[1-9]$/.test(event.key) && !event.shiftKey && !event.altKey) target = tabs[event.key === "9" ? tabs.length - 1 : Number(event.key) - 1];
      else if (event.key.toLowerCase() === "w" && !event.shiftKey && !event.altKey && active) {
        event.preventDefault();
        if (!active.pinned) void controller.close([active.pageId]);
        return;
      }
      if (target) { event.preventDefault();void controller.open(target.pageId); }
    };
    window.addEventListener("keydown", keys);return () => window.removeEventListener("keydown", keys);
  }, [active, activePageId, controller, tabs, keyboardActive]);
  const activate = (id: string) => { setSheet(false);void controller.open(id); };
  const rove = (event: KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else if (event.key === "Delete" && !tabs[index]!.pinned) { event.preventDefault();void controller.close([tabs[index]!.pageId]);return; }
    else return;
    event.preventDefault();strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();activate(tabs[next]!.pageId);
  };
  const menu = (tab: DocumentTab, index: number) => <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" className="document-tab-menu" aria-label={`Действия вкладки: ${label(tab.pageId)}`}><Ellipsis size={14}/></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content align="start" sideOffset={4} className="document-tab-context z-[80] rounded-md border bg-popover p-1 text-popover-foreground">
      {tab.mode === "preview" && <DropdownMenu.Item onSelect={() => controller.promote(tab.pageId)}>Оставить открытой</DropdownMenu.Item>}
      <DropdownMenu.Item onSelect={() => controller.pin(tab.pageId)}>{tab.pinned ? "Открепить вкладку" : "Закрепить вкладку"}</DropdownMenu.Item>
      <DropdownMenu.Item disabled={index === 0 || tabs[index-1]?.pinned !== tab.pinned} onSelect={() => controller.reorder(tab.pageId, tabs[index-1]!.pageId)}>Переместить влево</DropdownMenu.Item>
      <DropdownMenu.Item disabled={index === tabs.length-1 || tabs[index+1]?.pinned !== tab.pinned} onSelect={() => controller.reorder(tab.pageId, tabs[index+1]!.pageId)}>Переместить вправо</DropdownMenu.Item>
      {onMove && <DropdownMenu.Item onSelect={() => onMove(tab.pageId)}>Перенести в соседнюю панель · Ctrl/⌘ Alt Enter</DropdownMenu.Item>}
      <DropdownMenu.Separator className="my-1 border-t"/>
      <DropdownMenu.Item onSelect={() => void controller.close([tab.pageId], true)}>{tab.pinned ? "Закрыть закреплённую вкладку" : "Закрыть вкладку"}</DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => void controller.close(tabs.filter(t => t.pageId !== tab.pageId).map(t => t.pageId))}>Закрыть остальные</DropdownMenu.Item>
      <DropdownMenu.Item onSelect={() => void controller.close(tabs.slice(index+1).map(t => t.pageId))}>Закрыть справа</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
  if (!tabs.length) return null;
  return <div className="document-tabs notebook-no-print" aria-busy={controller.busy}>
    <div ref={strip} role="tablist" aria-label="Открытые документы" className="document-tabs-strip">
      {tabs.map((tab, index) => <div key={tab.pageId} className="document-tab" data-active={tab.pageId === activePageId} data-preview={tab.mode === "preview"} data-pinned={tab.pinned}
        draggable onDragStart={event => event.dataTransfer.setData("text/notebook-tab", tab.pageId)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault();event.stopPropagation();const id = event.dataTransfer.getData("text/notebook-tab");if (tabs.some(item => item.pageId === id)) controller.reorder(id, tab.pageId);else onReceive?.(id); }}>
        <span id={`document-tab-state-${tab.pageId}`} className="sr-only">{tab.pinned ? "Закреплена" : tab.mode === "preview" ? "Временная вкладка" : "Постоянная вкладка"}</span>
        <button id={`document-tab-${tab.pageId}`} type="button" role="tab" aria-controls={paneId ? `notebook-document-panel-${paneId}` : "notebook-document-panel"} aria-selected={tab.pageId === activePageId} aria-describedby={`document-tab-state-${tab.pageId}`} tabIndex={tab.pageId === activePageId ? 0 : -1} className="document-tab-activate" title={label(tab.pageId)}
          onKeyDown={event => rove(event,index)} onClick={() => activate(tab.pageId)} onDoubleClick={() => controller.promote(tab.pageId)}>{tab.pinned && <Pin size={12} aria-hidden="true"/>}<span>{label(tab.pageId)}</span></button>
        {menu(tab,index)}
        {!tab.pinned && <button type="button" className="document-tab-close" aria-label={`Закрыть вкладку: ${label(tab.pageId)}`} onClick={() => void controller.close([tab.pageId])}><X size={13}/></button>}
      </div>)}
    </div>
    <Dialog.Root open={sheet} onOpenChange={setSheet}>
      <Dialog.Trigger asChild><button type="button" className="document-tabs-switcher" aria-label={`Открытые документы (${tabs.length}): ${activePageId ? label(activePageId) : "выберите документ"}`}><span>{activePageId ? label(activePageId) : "Открытые документы"}</span><span className="document-tabs-count">{tabs.length}</span><ChevronDown size={15}/></button></Dialog.Trigger>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[60] bg-black/35"/><Dialog.Content aria-describedby={undefined} className="document-tabs-sheet fixed inset-x-0 bottom-0 z-[70] overflow-y-auto rounded-t-lg border-t bg-popover p-3 text-popover-foreground">
        <div className="mb-2 flex items-center"><Dialog.Title className="flex-1 text-sm font-semibold">Открытые документы</Dialog.Title><Dialog.Close className="document-tabs-sheet-action" aria-label="Закрыть список документов"><X size={18}/></Dialog.Close></div>
        {tabs.map((tab,index) => <div className="document-tabs-sheet-row" data-active={tab.pageId === activePageId} key={tab.pageId}>
          <button type="button" aria-current={tab.pageId === activePageId ? "page" : undefined} className="document-tabs-sheet-label" onClick={() => activate(tab.pageId)}>{tab.pinned && <Pin size={14}/>}<span>{label(tab.pageId)}{tab.mode === "preview" && <small> · Просмотр</small>}</span></button>
          {menu(tab,index)}
          <button type="button" className="document-tabs-sheet-action" aria-label={`${tab.pinned ? "Открепить" : "Закрепить"} вкладку: ${label(tab.pageId)}`} onClick={() => controller.pin(tab.pageId)}><Pin size={16}/></button>
          {!tab.pinned && <button type="button" className="document-tabs-sheet-action" aria-label={`Закрыть вкладку: ${label(tab.pageId)}`} onClick={() => void controller.close([tab.pageId])}><X size={17}/></button>}
        </div>)}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </div>;
}
