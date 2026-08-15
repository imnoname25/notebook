"use client";

import { useEffect, useState } from "react";
import { Download, RefreshCw, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

export function PwaClient() {
  const [online, setOnline] = useState(true); const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null); const [waiting, setWaiting] = useState<ServiceWorker | null>(null); const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const initialState = window.setTimeout(() => setOnline(navigator.onLine), 0); const onOnline = () => setOnline(true); const onOffline = () => setOnline(false); const beforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); }; let updateRequested = false; const onControllerChange = () => { if (updateRequested) window.location.reload(); };
    window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline); window.addEventListener("beforeinstallprompt", beforeInstall);
    navigator.serviceWorker?.addEventListener("controllerchange", onControllerChange);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").then((registration) => { if (registration.waiting) setWaiting(registration.waiting); registration.addEventListener("updatefound", () => { const worker = registration.installing; worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker); }); }); });
    const requestUpdate = () => { updateRequested = true; };
    window.addEventListener("notebook-sw-update", requestUpdate);
    return () => { window.clearTimeout(initialState); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); window.removeEventListener("beforeinstallprompt", beforeInstall); navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange); window.removeEventListener("notebook-sw-update", requestUpdate); };
  }, []);
  if (dismissed || (online && !installPrompt && !waiting)) return null;
  return <div className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[80] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-popover p-3 shadow-2xl ring-1 ring-border"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">{!online ? <WifiOff size={18}/> : waiting ? <RefreshCw size={18}/> : <Download size={18}/>}</span><p className="min-w-0 flex-1 text-sm">{!online ? "Нет сети. Изменения нельзя сохранить." : waiting ? "Доступно обновление Notebook" : "Установить Notebook как приложение"}</p>{waiting && <Button size="sm" onClick={() => { window.dispatchEvent(new Event("notebook-sw-update")); waiting.postMessage({ type: "SKIP_WAITING" }); }}>Обновить</Button>}{online && installPrompt && !waiting && <Button size="sm" onClick={() => { void installPrompt.prompt().then(() => installPrompt.userChoice).then(() => setInstallPrompt(null)); }}>Установить</Button>}<button className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent" onClick={() => setDismissed(true)} aria-label="Закрыть"><X size={16}/></button></div>;
}
