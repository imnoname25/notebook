"use client";

import {
  BookOpen,
  LogOut,
  Menu,
  Monitor,
  Moon,
  MoreVertical,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n/messages";
import { NotificationCenter } from "./notification-center";

type MobileAppHeaderProps = {
  userName: string;
  isAdmin: boolean;
  theme: string | undefined;
  resolvedTheme: string | undefined;
  menuOpen: boolean;
  androidClient: boolean;
  onMenu(): void;
  onSearch(): void;
  onMenuOpenChange(open: boolean): void;
  onSettings(): void;
  onTheme(): void;
  onChangeServer(): void;
  onLogout(): void;
  onLogoutAll(): void;
  onError(error: unknown): void;
};

export function MobileAppHeader(props: MobileAppHeaderProps) {
  const ThemeIcon =
    props.theme === "system"
      ? Monitor
      : props.resolvedTheme === "dark"
        ? Moon
        : Sun;
  const close = () => props.onMenuOpenChange(false);
  return (
    <Dialog.Root open={props.menuOpen} onOpenChange={props.onMenuOpenChange}>
      <header
        data-testid="mobile-app-header"
        className="notebook-mobile-header notebook-no-print flex h-16 shrink-0 items-center border-b border-border/60 px-2 md:hidden"
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-12 shrink-0"
          aria-label="Открыть навигацию"
          onClick={props.onMenu}
        >
          <Menu size={23} />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1 text-[18px] font-semibold">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BookOpen size={20} />
          </span>
          <span className="truncate">Notebook</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-12 shrink-0"
          aria-label="Поиск"
          onClick={props.onSearch}
        >
          <Search size={22} />
        </Button>
        <Dialog.Trigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-12 shrink-0"
            aria-label="Ещё"
          >
            <MoreVertical size={22} />
          </Button>
        </Dialog.Trigger>
      </header>
      <Dialog.Portal>
        <Dialog.Overlay className="notebook-no-print fixed inset-0 z-40 bg-black/30 md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="notebook-mobile-sheet notebook-no-print fixed inset-x-0 bottom-0 z-40 rounded-t-2xl bg-card shadow-2xl ring-1 ring-border md:hidden"
        >
          <Dialog.Title className="sr-only">Меню приложения</Dialog.Title>
          <div className="flex min-h-14 items-center border-b border-border/60 px-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{props.userName}</p>
              <p className="text-xs text-muted-foreground">Аккаунт Notebook</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-12"
              aria-label="Закрыть меню"
              onClick={close}
            >
              <X size={18} />
            </Button>
          </div>
          <div className="p-2">
            {props.isAdmin && (
              <NotificationCenter onError={props.onError} trigger="menu" />
            )}
            <button
              className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                close();
                props.onSettings();
              }}
            >
              <Settings size={18} />
              <span>Настройки</span>
            </button>
            <button
              className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                close();
                props.onTheme();
              }}
            >
              <ThemeIcon size={18} />
              <span>Переключить тему</span>
            </button>
            {props.androidClient && (
              <button
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  close();
                  props.onChangeServer();
                }}
              >
                <Server size={20} />
                <span>{t("mobile.changeServerLabel")}</span>
              </button>
            )}
            <button
              className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                close();
                props.onLogoutAll();
              }}
            >
              <ShieldCheck size={18} />
              <span>Выйти на всех устройствах</span>
            </button>
            <button
              className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-base text-destructive hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                close();
                props.onLogout();
              }}
            >
              <LogOut size={18} />
              <span>Выйти</span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
