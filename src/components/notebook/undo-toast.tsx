"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { t } from "@/lib/i18n/messages";
import { executeUndo, type ReversibleAction } from "@/lib/reversible-action";

export function UndoToast({ action, onClose, onError }: { action: ReversibleAction | null; onClose(): void; onError(error: unknown): void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!action) return;
    const timer = window.setTimeout(onClose, Math.max(0, action.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [action, onClose]);
  if (!action) return null;
  return <div role="status" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-[70] flex min-h-12 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-xl"><span className="min-w-0 flex-1">{action.message}</span><button type="button" disabled={busy} className="flex min-h-10 items-center gap-1.5 rounded-md px-2 font-medium hover:bg-background/10" onClick={() => { setBusy(true); void executeUndo(action).then(onClose).catch(onError).finally(() => setBusy(false)); }}>{busy ? <Loader2 size={15} className="animate-spin"/> : <RotateCcw size={15}/>} {t("undo.action")}</button><button type="button" className="flex size-10 items-center justify-center rounded-md hover:bg-background/10" onClick={onClose} aria-label={t("common.close")}><X size={16}/></button></div>;
}
