"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { X } from "lucide-react";
import { filterCommands, type PaletteCommand } from "@/lib/command-palette";

export function CommandPalette({ open, onOpenChange, commands }: { open: boolean; onOpenChange(open: boolean): void; commands: PaletteCommand[] }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35"/>
    <Dialog.Content className="fixed left-1/2 top-[8dvh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground" aria-describedby={undefined}>
      <Dialog.Title className="sr-only">Командная палитра</Dialog.Title>
      <PaletteItems commands={commands} close={() => onOpenChange(false)}/>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
function PaletteItems({ commands, close }: { commands: PaletteCommand[]; close(): void }) {
  const [query, setQuery] = useState("");
  const matched = filterCommands(commands, query.replace(/^>\s*/, ""));
  return <Command shouldFilter={false} loop label="Командная палитра">
    <div className="flex items-center border-b border-border px-3"><Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Введите команду…" className="h-12 min-w-0 flex-1 bg-transparent px-2 text-base outline-none"/><Dialog.Close className="flex size-11 items-center justify-center rounded hover:bg-accent" aria-label="Закрыть"><X size={18}/></Dialog.Close></div>
    <Command.List className="max-h-[65dvh] overflow-y-auto p-2">{!matched.length && <Command.Empty className="p-6 text-sm text-muted-foreground">Команды не найдены</Command.Empty>}{matched.map(command => <Command.Item key={command.id} value={command.id} disabled={command.disabled} onSelect={() => { close();command.run(); }} className="flex min-h-11 cursor-pointer items-center rounded px-3 text-sm outline-none data-[disabled=true]:opacity-40 data-[selected=true]:bg-accent">{command.title}</Command.Item>)}</Command.List>
  </Command>;
}
