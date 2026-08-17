"use client";

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bell, CheckCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Notification = { id: string; severity: "info" | "warning" | "error" | "success"; title: string; message: string; createdAt: string; readAt: string | null; resolvedAt: string | null };
export function NotificationCenter({ onError, trigger = "icon", onTrigger }: { onError(error: unknown): void; trigger?: "icon" | "menu"; onTrigger?(): void }) {
  const [open, setOpen] = useState(false); const [items, setItems] = useState<Notification[]>([]); const [unread, setUnread] = useState(0);
  const load = useCallback(async () => { try { const response = await api<{ notifications: Notification[]; unread: number }>("/api/notifications"); setItems(response.notifications); setUnread(response.unread); } catch (error) { onError(error); } }, [onError]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => { if (!open) return; const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer); }, [load, open]);
  async function mark(item: Notification) { if (item.readAt) return; try { await api(`/api/notifications/${item.id}`, jsonOptions("PATCH")); await load(); } catch (error) { onError(error); } }
  async function markAll() { try { await api("/api/notifications", jsonOptions("PATCH")); await load(); } catch (error) { onError(error); } }
  const triggerElement = trigger === "menu"
    ? <button className="relative flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onTrigger}><Bell size={18}/><span>Уведомления</span>{unread > 0 && <span className="ml-auto rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-white">{Math.min(unread, 99)}</span>}</button>
    : <Button variant="ghost" size="icon" className="relative size-11" aria-label={`Уведомления${unread ? `: ${unread}` : ""}`}><Bell size={17}/>{unread > 0 && <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-white">{Math.min(unread, 99)}</span>}</Button>;
  return <Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) void load(); }}><Dialog.Trigger asChild>{triggerElement}</Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-black/25"/><Dialog.Content aria-describedby={undefined} className="notebook-mobile-dialog fixed bottom-0 left-0 right-0 z-50 flex max-h-[80vh] flex-col rounded-t-2xl bg-card shadow-2xl sm:bottom-auto sm:left-auto sm:right-4 sm:top-16 sm:w-[420px] sm:rounded-2xl sm:pb-0"><header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4"><Bell size={17}/><Dialog.Title className="flex-1 font-semibold">Уведомления</Dialog.Title>{unread > 0 && <Button variant="ghost" size="sm" onClick={() => void markAll()}><CheckCheck size={15}/>Прочитать все</Button>}<Dialog.Close className="flex size-10 items-center justify-center rounded-lg hover:bg-accent" aria-label="Закрыть"><X size={17}/></Dialog.Close></header><div className="min-h-0 overflow-y-auto p-2">{items.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Системных уведомлений пока нет</p> : items.map((item) => <button key={item.id} className={cn("mb-1 block w-full rounded-xl p-3 text-left hover:bg-accent/60", !item.readAt && !item.resolvedAt && "bg-accent/35")} onClick={() => void mark(item)}><span className="flex items-center gap-2"><span className={cn("size-2 rounded-full", item.severity === "error" ? "bg-destructive" : item.severity === "warning" ? "bg-amber-500" : item.severity === "success" ? "bg-emerald-500" : "bg-blue-500")}/><span className="font-medium">{item.title}</span></span><span className="mt-1 block text-sm text-muted-foreground">{item.message}</span><span className="mt-2 block text-[11px] text-muted-foreground">{new Date(item.createdAt).toLocaleString("ru")}{item.resolvedAt ? " · устранено" : ""}</span></button>)}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
