"use client";

import { BookOpen, LogOut, Monitor, Moon, Settings, StickyNote, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { isDarkTheme, themeLabel } from "@/lib/themes";
import { t } from "@/lib/i18n/messages";
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
    <div className="notebook-window-actions ml-auto flex min-w-0 items-center gap-1">
      <span className="notebook-window-document hidden min-w-0 truncate px-3 text-xs text-muted-foreground lg:block" title={props.documentTitle ?? props.notebookTitle}>{props.documentTitle ?? props.notebookTitle}</span>
      {props.isAdmin && <NotificationCenter onError={props.onError}/>}
      <Button variant="ghost" size="icon" aria-label={t("quickNotes.title")} title={`${t("quickNotes.title")} (Ctrl/Cmd + Shift + N)`} onClick={props.onCapture}><StickyNote size={16}/></Button>
      <Button variant="ghost" size="icon" aria-label="Настройки" onClick={props.onSettings}><Settings size={16}/></Button>
      <Button variant="ghost" size="icon" aria-label="Переключить тему" title={`Тема: ${themeLabel(props.theme)}`} onClick={props.onTheme}><ThemeIcon size={16}/></Button>
      <span className="notebook-account-name hidden max-w-28 truncate px-2 text-xs text-muted-foreground xl:block">{props.userName}</span>
      <Button variant="ghost" size="icon" aria-label="Выйти" onClick={props.onLogout}><LogOut size={16}/></Button>
    </div>
  </header>;
}
