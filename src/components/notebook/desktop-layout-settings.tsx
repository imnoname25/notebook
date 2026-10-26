"use client";

import { RESET_DESKTOP_PANELS } from "@/lib/desktop-panel-layout";

export function DesktopLayoutSettings() {
  return <section className="workspace-layout-settings space-y-2 border-t border-border/60 pt-4 text-sm">
    <h3 className="font-medium">Компоновка рабочего места</h3>
    <p className="text-muted-foreground">Перетащите разделитель между панелями. Двойной щелчок сбрасывает одну ширину.</p>
    <button type="button" className="min-h-9 rounded border border-border px-3 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" onClick={() => window.dispatchEvent(new Event(RESET_DESKTOP_PANELS))}>Сбросить ширину панелей</button>
  </section>;
}
