"use client";
import { useEffect, type RefObject, type KeyboardEvent, type MouseEvent } from "react";
import { t } from "@/lib/i18n/messages";
import type { NotebookEditor } from "./editor-schema";
export function useEditorControls(editor: NotebookEditor, editorRoot: RefObject<HTMLDivElement | null> | HTMLDivElement | null) {
  useEffect(() => {
    const root = editorRoot && "current" in editorRoot ? editorRoot.current : editorRoot;
    if (!root) return;
    const enhance = () => {
      root.querySelectorAll<HTMLElement>(".bn-toggle-wrapper").forEach(wrapper => {
        const button = wrapper.querySelector(".bn-toggle-button");
        const expanded = wrapper.dataset.showChildren === "true";
        if (button?.getAttribute("aria-expanded") !== String(expanded)) button?.setAttribute("aria-expanded", String(expanded));
        const label = expanded ? "Свернуть дочерние блоки" : "Развернуть дочерние блоки";
        if (button?.getAttribute("aria-label") !== label) button?.setAttribute("aria-label", label);
      });
      root
        .querySelectorAll<HTMLElement>('[data-content-type="codeBlock"]')
        .forEach((block) => {
          const language = block.querySelector("select");
          if (language?.getAttribute("aria-label") !== "Язык кода") language?.setAttribute("aria-label", "Язык кода");
          if (block.querySelector(".notebook-code-copy")) return;
          const button = document.createElement("button");
          button.type = "button";
          button.className = "notebook-code-copy";
          button.contentEditable = "false";
          button.textContent = t("editor.copyCode");
          button.setAttribute("aria-label", t("editor.copyCode"));
          block.appendChild(button);
          const wrap = document.createElement("button");
          wrap.type = "button";
          wrap.className = "notebook-code-wrap";
          wrap.contentEditable = "false";
          wrap.textContent = "Перенос";
          wrap.setAttribute("aria-label", "Переносить длинные строки");
          wrap.setAttribute("aria-pressed", "false");
          block.appendChild(wrap);
        });
    };
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-show-children"] });
    return () => observer.disconnect();
  }, [editor, editorRoot]);
}
export function handleEditorControlKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.altKey && event.shiftKey && event.key.toLowerCase() === "t") {
    const summary = event.currentTarget.querySelector<HTMLElement>(".notebook-table-actions summary");
    if (summary) { event.preventDefault();event.stopPropagation();summary.focus();return; }
  }
          const target = event.target instanceof HTMLElement ? event.target : null;
          if (event.key === "Tab" && target?.matches("select, button") && target.closest('[data-content-type="codeBlock"]')) {
            // Native code Tab indentation must not trap focus in its form controls.
            event.stopPropagation();return;
          }
          if (event.key !== "Enter" && event.key !== " ") return;
          const button = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>("button.bn-toggle-button, .notebook-toggle > button") : null;
          if (!button) return;
          // ProseMirror otherwise handles Enter as editing even when a toggle has focus.
          event.preventDefault();
          event.stopPropagation();
          button.click();
}
export function handleCodeControlClick(event: MouseEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
          const copy = target.closest(".notebook-code-copy");
          if (copy) {
            event.preventDefault();
            const text =
              copy.parentElement?.querySelector("code")?.textContent ?? "";
            void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("Clipboard API unavailable"))).then(() => {
              copy.textContent = t("editor.copied");
              window.setTimeout(() => {
                copy.textContent = t("editor.copyCode");
              }, 1200);
            }).catch(() => { copy.textContent = "Не удалось скопировать"; });
            return true;
          }
          const wrap = target.closest<HTMLButtonElement>(".notebook-code-wrap");
          if (wrap) {
            event.preventDefault();
            const codeBlock = wrap.closest<HTMLElement>('[data-content-type="codeBlock"]');
            const enabled = !codeBlock?.classList.contains("notebook-code-wrap-enabled");
            codeBlock?.classList.toggle("notebook-code-wrap-enabled", enabled);
            wrap.setAttribute("aria-pressed", String(enabled));
            return true;
          }
  return false;
}
