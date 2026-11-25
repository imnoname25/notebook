import { createExtension } from "@blocknote/core";
import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";

export function isEditorLink(href: string): boolean {
  if (!href || /[\s\u0000-\u001f]/u.test(href)) return false;
  const scheme = /^[a-z][a-z\d.+-]*:/i.exec(href)?.[0].toLowerCase();
  return !scheme || /^(https?|ftp|ftps|mailto|tel|callto|sms|cid|xmpp|notebook-page):$/.test(scheme);
}

export function automaticLink(token: string): { text: string; href: string } | undefined {
  // Only complete tokens are candidates, so strings such as prefix=user@host
  // and Windows paths never acquire marks on substrings.
  const text = token.replace(/[.,;!?]+$/, "");
  if (/^https?:\/\//i.test(text) && !/[<>"'\\]/.test(text) && isEditorLink(text)) {
    try {
      const url = new URL(text);
      if (url.hostname && !url.username && !url.password) return { text, href: text };
    } catch { return; }
  }
  if (/^[a-z\d_+-]+(?:\.[a-z\d_+-]+)*@(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}$/i.test(text)) {
    return { text, href: `mailto:${text}` };
  }
}

const notebookLinkMark = Mark.create({
  name: "link",
  inclusive: false,
  keepOnSplit: false,
  exitable: true,
  addAttributes: () => ({ href: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute("href") } }),
  parseHTML: () => [{
    tag: "a[href]",
    getAttrs: element => isEditorLink(element.getAttribute("href") ?? "") ? null : false,
  }],
  renderHTML({ HTMLAttributes }) {
    return ["a", mergeAttributes(HTMLAttributes, {
      href: isEditorLink(HTMLAttributes.href ?? "") ? HTMLAttributes.href : "",
      class: "bn-inline-content-section",
      "data-inline-content-type": "link",
      draggable: "false",
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    }), 0];
  },
});

export const notebookLinksExtension = createExtension(() => ({
  key: "notebookLinks",
  tiptapExtensions: [notebookLinkMark],
  prosemirrorPlugins: [new Plugin({
    props: {
      handleClick(view, _position, event) {
        if (!view.editable || event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return false;
        const anchor = event.target.closest<HTMLAnchorElement>('a[data-inline-content-type="link"]');
        if (!anchor || !view.dom.contains(anchor) || !isEditorLink(anchor.getAttribute("href") ?? "")) return false;
        window.open(anchor.href, anchor.target, "noopener,noreferrer");
        return true;
      },
    },
    appendTransaction(transactions, _oldState, state) {
      // Automatic links are a typing operation. Clipboard input, history and
      // explicit unlink must never be interpreted by this rule.
      if (transactions.some(tr => tr.getMeta("uiEvent") || tr.getMeta("preventAutolink"))) return;
      const source = transactions.find(tr => tr.steps.length === 1 && tr.steps[0] instanceof ReplaceStep &&
        tr.steps[0].from === tr.steps[0].to && tr.steps[0].slice.content.childCount === 1 &&
        tr.steps[0].slice.content.firstChild?.isText && /^[ \t]$/.test(tr.steps[0].slice.content.firstChild.text ?? ""));
      const { $from, empty } = state.selection;
      if (!source || !empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return;
      const content = $from.doc.textBetween($from.start(), $from.pos, "", " ");
      const token = /(?:^|\s)(\S+)[ \t]$/.exec(content)?.[1];
      if (!token) return;
      const link = automaticLink(token);
      if (!link) return;
      const from = $from.pos - token.length - 1, to = from + link.text.length;
      const mark = state.schema.marks.link, code = state.schema.marks.code;
      if (state.doc.rangeHasMark(from, to, mark) || (code && state.doc.rangeHasMark(from, to, code))) return;
      return state.tr.addMark(from, to, mark.create({ href: link.href }));
    },
  })],
}));
