"use client";

import { BookOpen, LogOut, Monitor, Moon, Settings, StickyNote, Sun, UserRound } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { isDarkTheme, themeLabel } from "@/lib/themes";
import { NotificationCenter } from "./notification-center";

type Props = {
  userName: string;
  isAdmin: boolean;
  notebookTitle?: string;
  documentTitle?: string;
  theme?: string;
  resolvedTheme?: string;
  onHome(): void;
  search: ReactNode;
  onCapture(): void;
  onSettings(): void;
  onTheme(): void;
  onLogout(): void;
  onError(error: unknown): void;
};

export function DesktopAppHeader(props: Props) {
  const ThemeIcon = props.theme === "system" ? Monitor : isDarkTheme(props.resolvedTheme) ? Moon : Sun;
  return <header data-testid="desktop-app-header" className="notebook-desktop-header notebook-no-print hidden h-14 shrink-0 items-center border-b border-border/60 px-4 md:flex">
    <button type="button" className="notebook-brand flex items-center gap-2 rounded-lg font-semibold" onClick={props.onHome}>
      <BookOpen size={20} strokeWidth={1.5}/><span>Notebook</span>
    </button>
    {props.search}
    <div className="notebook-window-actions ml-auto flex min-w-0 items-center justify-end gap-1">
      {props.isAdmin && <NotificationCenter onError={props.onError}/>}
      <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button variant="ghost" size="icon" className="notebook-profile-trigger" aria-label={`Профиль: ${props.userName}`} title={props.userName}><UserRound size={18}/></Button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} onCloseAutoFocus={event => { if (document.querySelector(".quick-search-panel")) event.preventDefault(); }} className="notebook-profile-menu z-50 min-w-56 max-w-[calc(100vw-24px)] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-sm">
          <DropdownMenu.Label className="max-w-64 truncate px-3 py-2 text-sm font-semibold">{props.userName}</DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-border"/>
          <DropdownMenu.Item className="notebook-profile-item" onSelect={props.onCapture}><StickyNote size={16}/>Быстрая заметка<kbd className="ml-auto text-[10px] text-muted-foreground">Ctrl ⇧ N</kbd></DropdownMenu.Item>
          <DropdownMenu.Item className="notebook-profile-item" onSelect={props.onSettings}><Settings size={16}/>Настройки</DropdownMenu.Item>
          <DropdownMenu.Item className="notebook-profile-item" onSelect={props.onTheme}><ThemeIcon size={16}/><span>Переключить тему<span className="block text-xs text-muted-foreground">{themeLabel(props.theme)}</span></span></DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border"/>
          <DropdownMenu.Item className="notebook-profile-item" onSelect={props.onLogout}><LogOut size={16}/>Выйти</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  </header>;
}
