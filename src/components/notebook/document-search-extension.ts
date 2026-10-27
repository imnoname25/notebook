import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { documentMatches, type TextMatch } from "@/lib/document-search";

export type DocumentMatchState = { query: string; snippet: string; matches: TextMatch[]; active: number; decorations: DecorationSet };
export const documentSearchKey = new PluginKey<DocumentMatchState>("notebook-document-search");
export const SEARCH_MATCH_EVENT = "notebook:document-match-state";
function decorate(doc: ProseMirrorNode, matches: TextMatch[], active: number) {
  const decorations = matches.map((match, index) => Decoration.inline(match.from, match.to, { class: index === active ? "notebook-search-match notebook-search-current" : "notebook-search-match" }));
  const match = matches[active];
  if (match) {
    const ancestors = doc.resolve(match.from);
    // Reveal only the active path using view decorations, never toggle saved props.
    for (let depth = 1; depth <= ancestors.depth; depth++) {
      decorations.push(Decoration.node(ancestors.before(depth), ancestors.after(depth), { class: "notebook-search-reveal" }));
    }
  }
  return DecorationSet.create(doc, decorations);
}
export function createDocumentSearchPlugin() {
  return new Plugin<DocumentMatchState>({
    key: documentSearchKey,
    state: {
      init: () => ({ query: "", snippet: "", matches: [], active: -1, decorations: DecorationSet.empty }),
      apply(transaction, previous) {
        const command = transaction.getMeta(documentSearchKey) as { query?: string; snippet?: string; active?: number } | undefined;
        if (!command && (!transaction.docChanged || !previous.query)) return previous;
        const query = command?.query ?? previous.query;
        const snippet = command?.snippet ?? previous.snippet;
        if (!query) return { query, snippet: "", matches: [], active: -1, decorations: DecorationSet.empty };
        const found = !transaction.docChanged && command?.query === undefined ? { matches: previous.matches, preferred: previous.active } : documentMatches(transaction.doc, query, snippet);
        const active = command?.query !== undefined ? found.preferred : command?.active ?? previous.active;
        const bounded = found.matches.length ? Math.max(-1, Math.min(active, found.matches.length - 1)) : -1;
        return { query, snippet, matches: found.matches, active: bounded, decorations: decorate(transaction.doc, found.matches, bounded) };
      },
    },
    props: { decorations: state => documentSearchKey.getState(state)?.decorations },
    view: () => ({ update(view, previous) { if (documentSearchKey.getState(previous) !== documentSearchKey.getState(view.state)) view.dom.dispatchEvent(new Event(SEARCH_MATCH_EVENT)); } }),
  });
}
export const documentSearchExtension = createExtension({ key: "notebookDocumentSearch", prosemirrorPlugins: [createDocumentSearchPlugin()] });
