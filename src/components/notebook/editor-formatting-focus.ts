import { createExtension } from "@blocknote/core";
import { FormattingToolbarExtension } from "@blocknote/core/extensions";

export const formattingFocusExtension = createExtension(({ editor }) => ({
  key: "notebookFormattingFocus",
  mount({ root, signal }) {
    const toolbar = editor.getExtension(FormattingToolbarExtension)?.store;
    if (!toolbar) return;

    function dismissOutsideEditor(target: EventTarget | null) {
      if (toolbar?.state && target instanceof Element && !editor.isWithinEditor(target)) {
        toolbar.setState(false);
      }
    }

    root.addEventListener("focusin", event => dismissOutsideEditor(event.target), { capture: true, signal });
    // ProseMirror retains its selection when a different input takes focus.
    // A subsequent editor transaction can otherwise reopen the floating toolbar.
    const unsubscribe = toolbar.subscribe(() => dismissOutsideEditor(root.activeElement));
    signal.addEventListener("abort", unsubscribe, { once: true });
  },
}));
