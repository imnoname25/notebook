import { expect, test, type Page } from "@playwright/test";

const target = "Ctrl+C copies the visible link text and Ctrl+V preserves the styled link";
const inherited = new WeakMap<Page, object>();

async function appearanceOf(page: Page) {
  const account = await page.request.get("/api/account/preferences");
  const appearance = account.ok() ? (await account.json()).settings.appearance : {};
  return { theme: appearance.theme, mode: appearance.formattingToolbarMode };
}

export async function recordInheritedToolbarPreferences(page: Page) {
  if (test.info().title === target) inherited.set(page, await appearanceOf(page));
}

export async function waitForLinkCaret(page: Page, edge: "start" | "end") {
  await expect.poll(() => page.evaluate(edge => {
    const editor = document.querySelector(".bn-editor.ProseMirror") as (HTMLElement & {
      editor?: { view: {
        hasFocus(): boolean;
        posAtDOM(node: Node, offset: number): number;
        state: { selection: { head: number; empty: boolean } };
      } };
    }) | null;
    const selection = window.getSelection();
    const line = editor?.querySelector('[data-id="copy-link"] .bn-inline-content');
    const view = editor?.editor?.view;
    if (!selection?.isCollapsed || !selection.focusNode || !line?.contains(selection.focusNode) ||
        !view?.hasFocus() || !view.state.selection.empty) return false;
    const distance = document.createRange();
    distance.selectNodeContents(line);
    if (edge === "start") distance.setEnd(selection.focusNode, selection.focusOffset);
    else distance.setStart(selection.focusNode, selection.focusOffset);
    return distance.toString() === "" &&
      view.state.selection.head === view.posAtDOM(selection.focusNode, selection.focusOffset);
  }, edge), { message: `The browser and ProseMirror agree on the ${edge} of Named link` }).toBe(true);
}

test.beforeEach(async ({ page }, info) => {
  if (info.title !== target) return;
  await page.addInitScript(() => {
    const events: object[] = [];
    const state = window as Window & { notebookToolbarProbe?: object[] };
    state.notebookToolbarProbe = events;
    type EditorElement = HTMLElement & {
      editor?: {
        view?: {
          hasFocus(): boolean;
          state: { selection: { anchor: number; head: number; empty: boolean } };
        };
      };
    };
    const identifier = (node: Node | null) => {
      const element = node instanceof Element ? node : node?.parentElement;
      const id = element?.closest("[data-id]")?.getAttribute("data-id");
      return id === "copy-link" || id === "copy-plain" ? id : null;
    };
    const snapshot = (event: string) => {
      if (events.length >= 170) return;
      const editor = document.querySelector<EditorElement>(".bn-editor.ProseMirror");
      const active = document.activeElement;
      const selection = window.getSelection();
      const fixed = document.querySelector(".editor-formatting-toolbar");
      const selected = selection?.toString();
      let pmSelection, pmFocused;
      try {
        const view = editor?.editor?.view;
        pmSelection = view?.state.selection;
        pmFocused = view?.hasFocus();
      } catch {
        // The view may be mounting or unmounting.
      }
      events.push({
        event,
        readyState: document.readyState,
        documentFocused: document.hasFocus(),
        fixtureRendered: editor?.querySelector('[data-id="copy-link"] a')?.textContent === "Named link",
        editable: editor?.isContentEditable ?? false,
        activeTag: active?.tagName,
        activeIsEditor: active === editor,
        activeWithinEditor: active ? editor?.contains(active) : false,
        activeBlock: identifier(active),
        pmFocused,
        pm: pmSelection && { anchor: pmSelection.anchor, head: pmSelection.head, empty: pmSelection.empty },
        selection: selection && {
          type: selection.type, collapsed: selection.isCollapsed, length: selected?.length,
          expected: selected === "Named link", anchorBlock: identifier(selection.anchorNode),
          anchorOffset: selection.anchorOffset, focusBlock: identifier(selection.focusNode), focusOffset: selection.focusOffset,
        },
        toolbarMode: fixed?.getAttribute("data-toolbar-mode"),
        toolbarLayout: fixed?.getAttribute("data-toolbar-layout"),
        floating: Boolean(document.querySelector(".bn-formatting-toolbar")),
      });
    };
    document.addEventListener("selectionchange", () => snapshot("selectionchange"));
    document.addEventListener("focusin", () => snapshot("focusin"));
    document.addEventListener("pointerup", () => snapshot("pointerup"), true);
    document.addEventListener("keyup", event => {
      if (["Home", "ArrowUp", "End"].includes(event.key)) {
        snapshot(`keyup:${event.shiftKey ? "Shift+" : ""}${event.key}`);
        if (event.key === "Home" && event.shiftKey) requestAnimationFrame(() => snapshot("frame:Shift+Home"));
      }
    }, true);
    window.addEventListener("notebook-test-toolbar-snapshot", () => snapshot("end"));
  });
});

test.afterEach(async ({ page }, info) => {
  if (info.title !== target) return;
  const events = await page.evaluate(() => {
    window.dispatchEvent(new Event("notebook-test-toolbar-snapshot"));
    return (window as Window & { notebookToolbarProbe?: object[] }).notebookToolbarProbe;
  });
  const evidence = { index: info.repeatEachIndex, status: info.status, inherited: inherited.get(page), account: await appearanceOf(page), events };
  await info.attach("toolbar-diagnostics", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  const file = info.outputPath("toolbar-diagnostics.json");
  const fs = await import("node:fs/promises");
  await fs.mkdir(info.outputDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(evidence, null, 2));
});
