import { createExtension } from "@blocknote/core";
import { Plugin, TextSelection, type Selection } from "prosemirror-state";

export function selectedLinkAddress(selection: Selection): string | undefined {
  if (!(selection instanceof TextSelection) || selection.empty) return;
  const { $from, $to } = selection;
  if (!$from.sameParent($to)) return;

  const link = $from.nodeAfter?.marks.find(mark => mark.type.name === "link");
  if (!link || typeof link.attrs.href !== "string" || !link.attrs.href) return;
  if (link.isInSet($from.nodeBefore?.marks ?? []) || link.isInSet($to.nodeAfter?.marks ?? [])) return;

  let onlyLink = true;
  selection.content().content.descendants(node => {
    if (node.isInline && (!node.isText || !link.isInSet(node.marks))) onlyLink = false;
  });
  return onlyLink ? link.attrs.href : undefined;
}

export const linkCopyExtension = createExtension(() => ({
  key: "notebookLinkCopy",
  prosemirrorPlugins: [new Plugin({
    view(view) {
      function copy(event: ClipboardEvent) {
        // ProseMirror installs its copy listener before plugin views. Keep
        // BlockNote's rich formats and replace only its plain-text fallback.
        if (!event.defaultPrevented || !event.clipboardData?.types.includes("text/html")) return;
        const address = selectedLinkAddress(view.state.selection);
        if (address) event.clipboardData.setData("text/plain", address);
      }

      const dom = view.dom;
      dom.addEventListener("copy", copy);
      return { destroy: () => dom.removeEventListener("copy", copy) };
    },
  })],
}));
