"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Activity, CalendarClock, Clock3, FileJson, Globe2, Loader2, LockKeyhole, Pencil, RefreshCw, Server, X } from "lucide-react";
import { createReactBlockSpec } from "@blocknote/react";
import { Button } from "@/components/ui/button";
import { api, jsonOptions } from "@/lib/client-api";
import { formatCountdown, liveWidgetConfigSchema, liveWidgetTarget, type LiveWidgetConfig, type LiveWidgetSafeResult, type LiveWidgetType } from "@/lib/live-widgets";

export const LiveWidgetPageContext = createContext<string | null>(null);
export const LIVE_WIDGET_LABELS: Record<LiveWidgetType, string> = { HTTP_STATUS: "HTTP status", TCP_CHECK: "TCP порт", TLS_CERTIFICATE: "TLS-сертификат", JSON_VALUE: "JSON value", DATETIME: "Дата и время", COUNTDOWN: "Обратный отсчёт" };
const REFRESH_MS: Record<string, number> = { MIN_1: 60_000, MIN_5: 300_000, MIN_15: 900_000, HOUR_1: 3_600_000 };
const icons = { HTTP_STATUS: Globe2, TCP_CHECK: Server, TLS_CERTIFICATE: LockKeyhole, JSON_VALUE: FileJson, DATETIME: Clock3, COUNTDOWN: CalendarClock };

export function defaultLiveWidgetConfig(type: LiveWidgetType): LiveWidgetConfig {
  if (type === "HTTP_STATUS") return { type, url: "https://example.com/", method: "HEAD", expectedMin: 200, expectedMax: 399 };
  if (type === "TCP_CHECK") return { type, host: "example.com", port: 443, timeoutMs: 3000 };
  if (type === "TLS_CERTIFICATE") return { type, hostname: "example.com", port: 443, timeoutMs: 3000 };
  if (type === "JSON_VALUE") return { type, url: "https://example.com/status.json", path: "status", label: "" };
  if (type === "DATETIME") return { type, timeZone: "Asia/Yekaterinburg", format: "DATE_TIME" };
  return { type, targetAt: new Date(Date.now() + 86_400_000).toISOString() };
}

export const liveWidgetBlock = createReactBlockSpec({ type: "liveWidget", propSchema: {
  widgetType: { default: "HTTP_STATUS", values: ["HTTP_STATUS", "TCP_CHECK", "TLS_CERTIFICATE", "JSON_VALUE", "DATETIME", "COUNTDOWN"] as const },
  title: { default: "" }, config: { default: JSON.stringify(defaultLiveWidgetConfig("HTTP_STATUS")) },
  refreshMode: { default: "MANUAL", values: ["MANUAL", "MIN_1", "MIN_5", "MIN_15", "HOUR_1"] as const },
  displaySize: { default: "NORMAL", values: ["COMPACT", "NORMAL"] as const }, targetLabel: { default: "https://example.com/" },
}, content: "none" }, {
  render: ({ block, editor }) => <LiveWidgetCard block={block} update={(props) => editor.updateBlock(block, { props })}/>,
  toExternalHTML: ({ block }) => <aside data-live-widget={block.props.widgetType}><strong>{block.props.title || LIVE_WIDGET_LABELS[block.props.widgetType]}</strong><span>{block.props.targetLabel}</span></aside>,
})();

function LiveWidgetCard({ block, update }: { block: { id: string; props: { widgetType: LiveWidgetType; title: string; config: string; refreshMode: string; displaySize: string; targetLabel: string } }; update(props: Record<string, unknown>): void }) {
  const pageId = useContext(LiveWidgetPageContext);
  const config = useMemo(() => { try { return liveWidgetConfigSchema.parse(JSON.parse(block.props.config)); } catch { return defaultLiveWidgetConfig(block.props.widgetType); } }, [block.props.config, block.props.widgetType]);
  const remote = !["DATETIME", "COUNTDOWN"].includes(config.type);
  const [result, setResult] = useState<LiveWidgetSafeResult>({ status: "UNKNOWN", value: "Неизвестно", checkedAt: "" });
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(async () => {
    if (!pageId || !remote || loadingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) { setResult({ status: "UNKNOWN", value: "Нет сети", checkedAt: "" }); return; }
    loadingRef.current = true; setLoading(true);
    try { setResult((await api<{ result: LiveWidgetSafeResult }>(`/api/pages/${pageId}/live-widgets/${block.id}/refresh`, jsonOptions("POST"))).result); }
    catch (error) { setResult({ status: "UNKNOWN", value: "Неизвестно", detail: error instanceof Error ? error.message : "Проверка не выполнена", checkedAt: "" }); }
    finally { loadingRef.current = false; setLoading(false); }
  }, [block.id, pageId, remote]);
  useEffect(() => {
    if (!pageId || !remote) return;
    const controller = new AbortController();
    void api<{ result: LiveWidgetSafeResult }>(`/api/pages/${pageId}/live-widgets/${block.id}/refresh`, { signal: controller.signal }).then(({ result: value }) => {
      setResult(value);
      const interval = REFRESH_MS[block.props.refreshMode];
      const checkedAt = Date.parse(value.checkedAt);
      if (interval && document.visibilityState === "visible" && (!Number.isFinite(checkedAt) || Date.now() - checkedAt >= interval)) void refresh();
    }).catch(() => undefined);
    return () => controller.abort();
  }, [block.id, block.props.refreshMode, pageId, refresh, remote]);
  useEffect(() => {
    if (!remote || block.props.refreshMode === "MANUAL") return;
    const interval = REFRESH_MS[block.props.refreshMode]; if (!interval) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, interval);
    return () => window.clearInterval(timer);
  }, [block.props.refreshMode, refresh, remote]);
  useEffect(() => {
    if (remote) return;
    const timer = window.setInterval(() => setNow(Date.now()), config.type === "COUNTDOWN" ? 30_000 : 1_000);
    return () => window.clearInterval(timer);
  }, [config.type, remote]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("notebook:editor-overlay", { detail: configOpen }));
    const close = () => setConfigOpen(false);
    window.addEventListener("notebook:close-editor-overlay", close);
    return () => window.removeEventListener("notebook:close-editor-overlay", close);
  }, [configOpen]);
  const local: LiveWidgetSafeResult | null = config.type === "DATETIME" ? localDateTime(config, now) : config.type === "COUNTDOWN" ? { status: new Date(config.targetAt).getTime() <= now ? "WARNING" : "ONLINE", value: formatCountdown(config.targetAt, new Date(now)), detail: new Date(config.targetAt).toLocaleString("ru"), checkedAt: "" } : null;
  const shown = local ?? result;
  const Icon = icons[config.type];
  return <div className="notebook-live-widget" data-status={shown.status} data-size={block.props.displaySize} contentEditable={false}>
    <header><span className="notebook-live-widget-icon"><Icon size={18}/></span><strong className="min-w-0 flex-1 truncate">{block.props.title || LIVE_WIDGET_LABELS[config.type]}</strong>{remote && <button className="notebook-live-action" aria-label="Обновить Live Widget" onClick={() => void refresh()} disabled={loading}>{loading ? <Loader2 className="animate-spin" size={17}/> : <RefreshCw size={17}/>}</button>}<button className="notebook-live-action" aria-label="Настроить Live Widget" onClick={() => setConfigOpen(true)}><Pencil size={16}/></button></header>
    <div className="notebook-live-value"><span className="notebook-live-dot" aria-hidden="true"/><span>{shown.value}</span></div>
    {block.props.displaySize === "NORMAL" && <>{shown.detail && <p className="notebook-live-detail">{shown.detail}</p>}{shown.latencyMs !== undefined && <p className="notebook-live-detail">{shown.latencyMs} мс</p>}<footer>{shown.checkedAt ? `Проверено ${new Date(shown.checkedAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" })}` : remote ? "Ещё не проверялось" : liveWidgetTarget(config)}</footer></>}
    <span className="sr-only" aria-live="polite">{loading ? "Проверка" : shown.value}</span>
    <LiveWidgetConfigDialog open={configOpen} config={config} title={block.props.title} refreshMode={block.props.refreshMode} displaySize={block.props.displaySize} onOpenChange={setConfigOpen} onSave={(next) => { update({ widgetType: next.config.type, config: JSON.stringify(next.config), targetLabel: liveWidgetTarget(next.config), title: next.title, refreshMode: next.refreshMode, displaySize: next.displaySize }); setResult({ status: "UNKNOWN", value: "Неизвестно", checkedAt: "" }); }}/>
  </div>;
}

function localDateTime(config: Extract<LiveWidgetConfig, { type: "DATETIME" }>, now: number) {
  try { const options: Intl.DateTimeFormatOptions = config.format === "TIME" ? { hour: "2-digit", minute: "2-digit" } : config.format === "DATE" ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }; return { status: "ONLINE" as const, value: new Intl.DateTimeFormat("ru", { ...options, timeZone: config.timeZone }).format(new Date(now)), detail: config.timeZone, checkedAt: "" }; }
  catch { return { status: "WARNING" as const, value: "Некорректный часовой пояс", detail: config.timeZone, checkedAt: "" }; }
}

function LiveWidgetConfigDialog({ open, config, title, refreshMode, displaySize, onOpenChange, onSave }: { open: boolean; config: LiveWidgetConfig; title: string; refreshMode: string; displaySize: string; onOpenChange(open: boolean): void; onSave(value: { config: LiveWidgetConfig; title: string; refreshMode: string; displaySize: string }): void }) {
  const [type, setType] = useState<LiveWidgetType>(config.type);
  const [draft, setDraft] = useState<Record<string, unknown>>(config);
  const [name, setName] = useState(title);
  const [refresh, setRefresh] = useState(refreshMode);
  const [size, setSize] = useState(displaySize);
  const [error, setError] = useState("");
  const field = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));
  function choose(next: LiveWidgetType) { const value = defaultLiveWidgetConfig(next); setType(next); setDraft(value); }
  function save() { try { const parsed = liveWidgetConfigSchema.parse({ ...draft, type }); onSave({ config: parsed, title: name.trim(), refreshMode: refresh, displaySize: size }); onOpenChange(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "Проверьте настройки"); } }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="notebook-dialog-overlay fixed inset-0 z-[70] bg-black/40"/><Dialog.Content aria-describedby={undefined} className="notebook-dialog-content notebook-mobile-sheet fixed inset-x-0 bottom-0 z-[71] max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-card p-4 shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(520px,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-5"><header className="mb-4 flex items-center gap-3"><Activity size={20}/><Dialog.Title className="flex-1 font-semibold">Настроить Live Widget</Dialog.Title><Dialog.Close className="notebook-live-action" aria-label="Закрыть"><X size={18}/></Dialog.Close></header>
    <label className="notebook-live-field">Тип<select className="input" value={type} onChange={(event) => choose(event.target.value as LiveWidgetType)}>{Object.entries(LIVE_WIDGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="notebook-live-field">Название<input className="input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Необязательно"/></label>
    {(type === "HTTP_STATUS" || type === "JSON_VALUE") && <label className="notebook-live-field">URL<input className="input" type="url" value={String(draft.url ?? "")} onChange={(event) => field("url", event.target.value)}/></label>}
    {type === "HTTP_STATUS" && <><label className="notebook-live-field">Метод<select className="input" value={String(draft.method)} onChange={(event) => field("method", event.target.value)}><option>HEAD</option><option>GET</option></select></label><div className="grid grid-cols-2 gap-3"><label className="notebook-live-field">Status от<input className="input" type="number" value={Number(draft.expectedMin)} onChange={(event) => field("expectedMin", Number(event.target.value))}/></label><label className="notebook-live-field">Status до<input className="input" type="number" value={Number(draft.expectedMax)} onChange={(event) => field("expectedMax", Number(event.target.value))}/></label></div></>}
    {type === "TCP_CHECK" && <><label className="notebook-live-field">Host<input className="input" value={String(draft.host ?? "")} onChange={(event) => field("host", event.target.value)}/></label><label className="notebook-live-field">Port<input className="input" type="number" value={Number(draft.port)} onChange={(event) => field("port", Number(event.target.value))}/></label></>}
    {type === "TLS_CERTIFICATE" && <><label className="notebook-live-field">Hostname<input className="input" value={String(draft.hostname ?? "")} onChange={(event) => field("hostname", event.target.value)}/></label><label className="notebook-live-field">Port<input className="input" type="number" value={Number(draft.port)} onChange={(event) => field("port", Number(event.target.value))}/></label></>}
    {type === "JSON_VALUE" && <><label className="notebook-live-field">JSON path<input className="input" value={String(draft.path ?? "")} onChange={(event) => field("path", event.target.value)} placeholder="data.version"/></label><label className="notebook-live-field">Подпись<input className="input" value={String(draft.label ?? "")} onChange={(event) => field("label", event.target.value)}/></label></>}
    {type === "DATETIME" && <><label className="notebook-live-field">Часовой пояс<input className="input" value={String(draft.timeZone ?? "")} onChange={(event) => field("timeZone", event.target.value)} placeholder="Europe/London"/></label><label className="notebook-live-field">Формат<select className="input" value={String(draft.format)} onChange={(event) => field("format", event.target.value)}><option value="DATE_TIME">Дата и время</option><option value="TIME">Время</option><option value="DATE">Дата</option></select></label></>}
    {type === "COUNTDOWN" && <label className="notebook-live-field">Дата и время<input className="input" type="datetime-local" value={String(draft.targetAt ?? "").slice(0, 16)} onChange={(event) => { const date = new Date(event.target.value); if (!Number.isNaN(date.getTime())) field("targetAt", date.toISOString()); }}/></label>}
    <div className="grid grid-cols-2 gap-3"><label className="notebook-live-field">Обновление<select className="input" value={refresh} disabled={type === "DATETIME" || type === "COUNTDOWN"} onChange={(event) => setRefresh(event.target.value)}><option value="MANUAL">Вручную</option><option value="MIN_1">1 мин</option><option value="MIN_5">5 мин</option><option value="MIN_15">15 мин</option><option value="HOUR_1">1 час</option></select></label><label className="notebook-live-field">Размер<select className="input" value={size} onChange={(event) => setSize(event.target.value)}><option value="COMPACT">Компактный</option><option value="NORMAL">Обычный</option></select></label></div>
    {error && <p className="mt-3 text-sm text-destructive">{error}</p>}<footer className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button><Button onClick={save}>Применить</Button></footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
