"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createReactInlineContentSpec } from "@blocknote/react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { api } from "@/lib/client-api";
import { linkTargetsSchema, type LinkTarget } from "@/lib/page-links";
import { getPageHref } from "@/lib/workspace-navigation";

type LinkContext = { targets: Map<string, LinkTarget>; loaded: boolean; adjacent: boolean; navigate(id: string, adjacent?: boolean, permanent?: boolean): Promise<void> };
const Context = createContext<LinkContext>({ targets: new Map(), loaded: false, adjacent: false, navigate: async () => {} });
export const PAGE_METADATA_EVENT = "notebook:page-metadata-changed";
export function PageLinksProvider({ ids, navigate, adjacent, children }: { ids: string[]; navigate: LinkContext["navigate"]; adjacent: boolean; children: ReactNode }) {
  const key = [...new Set(ids)].sort().join(",");
  const [metadata, setMetadata] = useState<{ key: string; targets: Map<string, LinkTarget> }>({ key: "", targets: new Map() });
  useEffect(() => {
    let controller = new AbortController();let timer: ReturnType<typeof setTimeout>;let generation = 0;
    const refresh = () => { clearTimeout(timer);controller.abort();const version = ++generation;timer = setTimeout(() => {
      controller = new AbortController();
      const groups = key ? key.split(",") : [];
      void Promise.all(Array.from({ length: Math.ceil(groups.length / 100) }, (_, index) => api<unknown>(`/api/pages/link-targets?ids=${groups.slice(index * 100, (index + 1) * 100).join(",")}`, { signal: controller.signal }).then(value => linkTargetsSchema.parse(value).pages)))
        .then(results => { if (!controller.signal.aborted && generation === version) setMetadata({ key, targets: new Map(results.flat().map(page => [page.id, page])) }); }).catch(() => undefined);
    }, 180); };
    refresh();window.addEventListener(PAGE_METADATA_EVENT, refresh);window.addEventListener("focus", refresh);
    const interval = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30_000);
    return () => { controller.abort();clearTimeout(timer);clearInterval(interval);window.removeEventListener(PAGE_METADATA_EVENT, refresh);window.removeEventListener("focus", refresh); };
  }, [key]);
  return <Context.Provider value={{ targets: metadata.targets, loaded: metadata.key === key, adjacent, navigate }}>{children}</Context.Provider>;
}

export const pageLinkInline = createReactInlineContentSpec({ type: "pageLink", propSchema: { pageId: { default: "" }, text: { default: "" }, alias: { default: false } }, content: "none" }, {
  runsBefore: ["link"],
  render: function PageLink({ inlineContent, updateInlineContent, editor }) {
    const context = useContext(Context);const { pageId, text, alias } = inlineContent.props;const target = context.targets.get(pageId);
    const unavailable = pageId.startsWith("missing-") || context.loaded && !target;const [error, setError] = useState("");const [menu, setMenu] = useState(false);
    const open = (adjacent = false, permanent = false) => { if (unavailable) { setError("Страница недоступна: удалена или нет доступа");return; }void context.navigate(pageId, adjacent, permanent).catch(() => setError("Не удалось открыть страницу. Проверьте соединение.")); };
    return <Menu.Root open={menu} onOpenChange={setMenu}><Menu.Trigger asChild><a href={getPageHref(pageId)} className="notebook-page-link" data-unavailable={unavailable} data-target-page={pageId} contentEditable={false} title={target ? `${target.notebookTitle} / ${target.sectionTitle}` : "Страница недоступна"} onPointerDown={event => event.preventDefault()}
      onClick={event => { event.preventDefault();event.stopPropagation();open(false, event.ctrlKey || event.metaKey); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault();event.stopPropagation();open(false, event.ctrlKey || event.metaKey); } }}
      onContextMenu={event => { event.preventDefault();setMenu(true); }}>
      {unavailable ? (text || "Страница недоступна") : alias ? text : (target?.title ?? text) || "Страница"}
    </a></Menu.Trigger><Menu.Portal><Menu.Content className="document-tab-context z-[90] rounded-md border bg-popover p-1 text-popover-foreground" sideOffset={4}>
      <Menu.Item onSelect={() => open()}>Открыть страницу</Menu.Item>{editor.isEditable && <Menu.Item onSelect={() => { const value = window.prompt("Подпись внутренней ссылки (пусто — актуальное название)", alias ? text : "");if (value !== null) updateInlineContent({ type: "pageLink", props: { ...inlineContent.props, text: value || target?.title || text, alias: Boolean(value) } }); }}>Изменить подпись</Menu.Item>}{context.adjacent && <Menu.Item onSelect={() => open(true)}>Открыть в соседней панели</Menu.Item>}
    </Menu.Content></Menu.Portal>{error && <span role="status" className="notebook-link-error" onClick={() => setError("")}>{error}</span>}</Menu.Root>;
  },
  toExternalHTML: ({ inlineContent }) => <span data-notebook-page-id={inlineContent.props.pageId} data-notebook-alias={String(inlineContent.props.alias)}><a href={getPageHref(inlineContent.props.pageId)}>{inlineContent.props.text || "Страница"}</a></span>,
  parse: element => {
    const pageId = element.getAttribute("data-notebook-page-id");
    return pageId && /^[A-Za-z0-9_-]{1,200}$/.test(pageId) ? { pageId, text: element.textContent ?? "", alias: element.getAttribute("data-notebook-alias") === "true" } : undefined;
  },
});
