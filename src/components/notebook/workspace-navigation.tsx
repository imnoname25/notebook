"use client";

import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Only the navigation moves into a portal; the editor keeps its DOM and save queue. */
export function WorkspaceNavigation({ studio, open, onOpenChange, visible, children }: {
  studio: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  visible: boolean;
  children: ReactNode;
}) {
  const query = studio ? "(max-width: 1199px)" : "(max-width: 767px)";
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }, [query]);
  const compact = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
  useEffect(() => { if (!compact && open) onOpenChange(false); }, [compact, open, onOpenChange]);

  if (!compact || !studio) return <div data-mobile-screen="navigation" className={cn("notebook-no-print min-h-0 min-w-0", !visible && "hidden md:block")}>{children}</div>;
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="notebook-navigation-overlay notebook-no-print fixed inset-0 z-40 bg-black/30" />
      <Dialog.Content id="notebook-navigation-drawer" aria-describedby={undefined} className="notebook-navigation-drawer notebook-no-print fixed left-0 z-50 flex min-h-0 flex-col border-r border-border bg-sidebar" onCloseAutoFocus={(event) => {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>('[aria-label="Открыть навигацию"]')?.focus({ preventScroll: true });
      }}>
        <div className="notebook-navigation-drawer-heading flex shrink-0 items-center justify-between border-b border-border px-3">
          <Dialog.Title className="text-sm font-semibold">Навигация</Dialog.Title>
          <Dialog.Close className="flex size-11 items-center justify-center rounded hover:bg-accent" aria-label="Закрыть навигацию"><X size={20}/></Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
