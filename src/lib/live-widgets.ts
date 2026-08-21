import { z } from "zod";

export const LIVE_WIDGET_TYPES = ["HTTP_STATUS", "TCP_CHECK", "TLS_CERTIFICATE", "JSON_VALUE", "DATETIME", "COUNTDOWN"] as const;
export const LIVE_WIDGET_REFRESH_MODES = ["MANUAL", "MIN_1", "MIN_5", "MIN_15", "HOUR_1"] as const;
export const LIVE_WIDGET_SIZES = ["COMPACT", "NORMAL"] as const;
export type LiveWidgetType = (typeof LIVE_WIDGET_TYPES)[number];
export type LiveWidgetStatus = "ONLINE" | "WARNING" | "OFFLINE" | "UNKNOWN";

const httpUrl = z.string().trim().max(2048).url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
}, "Разрешён только HTTP(S) URL без credentials");
const host = z.string().trim().min(1).max(253).regex(/^(?:\[[0-9a-f:]+\]|[0-9a-f:.]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*)$/iu, "Некорректный hostname").transform((value) => value.replace(/^\[|\]$/g, "").toLowerCase());
const port = z.number().int().min(1).max(65535);
const timeout = z.number().int().min(500).max(5000).default(3000);
const timeZone = z.string().trim().min(1).max(100).refine((value) => { try { new Intl.DateTimeFormat("ru", { timeZone: value }); return true; } catch { return false; } }, "Некорректный часовой пояс");

export const liveWidgetConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("HTTP_STATUS"), url: httpUrl, method: z.enum(["HEAD", "GET"]).default("HEAD"), expectedMin: z.number().int().min(100).max(599).default(200), expectedMax: z.number().int().min(100).max(599).default(399) }).strict().refine((value) => value.expectedMin <= value.expectedMax, "Некорректный диапазон HTTP status"),
  z.object({ type: z.literal("TCP_CHECK"), host, port, timeoutMs: timeout }).strict(),
  z.object({ type: z.literal("TLS_CERTIFICATE"), hostname: host, port: port.default(443), timeoutMs: timeout }).strict(),
  z.object({ type: z.literal("JSON_VALUE"), url: httpUrl, path: z.string().trim().min(1).max(300).regex(/^[\p{L}\p{N}_-]+(?:\.(?:[\p{L}\p{N}_-]+|\d+))*$/u, "Используйте простой JSON path"), label: z.string().trim().max(100).default("") }).strict(),
  z.object({ type: z.literal("DATETIME"), timeZone, format: z.enum(["DATE_TIME", "TIME", "DATE"]).default("DATE_TIME") }).strict(),
  z.object({ type: z.literal("COUNTDOWN"), targetAt: z.string().datetime({ offset: true }) }).strict(),
]);
export type LiveWidgetConfig = z.infer<typeof liveWidgetConfigSchema>;

export const liveWidgetPropsSchema = z.object({
  widgetType: z.enum(LIVE_WIDGET_TYPES),
  title: z.string().trim().max(120),
  config: z.string().max(4096).transform((value, context) => { try { return liveWidgetConfigSchema.parse(JSON.parse(value)); } catch { context.addIssue({ code: "custom", message: "Некорректная конфигурация Live Widget" }); return z.NEVER; } }),
  refreshMode: z.enum(LIVE_WIDGET_REFRESH_MODES),
  displaySize: z.enum(LIVE_WIDGET_SIZES),
  targetLabel: z.string().trim().max(2048),
}).strict().refine((value) => value.widgetType === value.config.type, "Тип widget не совпадает с config");

export type LiveWidgetSafeResult = { status: LiveWidgetStatus; value: string; detail?: string; latencyMs?: number; checkedAt: string };

export function readJsonPath(value: unknown, path: string): unknown {
  const parts = path.split(".");
  let current = value;
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/u.test(part)) current = current[Number(part)];
    else if (current && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, part)) current = (current as Record<string, unknown>)[part];
    else throw new Error("INVALID_JSON_PATH");
  }
  return current;
}

export function compactJsonValue(value: unknown) {
  if (["string", "number", "boolean"].includes(typeof value)) return String(value).slice(0, 500);
  if (value === null) return "null";
  const serialized = JSON.stringify(value);
  if (serialized.length > 1000) throw new Error("JSON_VALUE_TOO_LARGE");
  return serialized;
}

export function tlsDaysRemaining(validTo: string, now = new Date()) {
  return Math.ceil((new Date(validTo).getTime() - now.getTime()) / 86_400_000);
}

export function formatCountdown(targetAt: string, now = new Date()) {
  const milliseconds = new Date(targetAt).getTime() - now.getTime();
  if (milliseconds <= 0) return "Истекло";
  const minutes = Math.ceil(milliseconds / 60_000);
  const days = Math.floor(minutes / 1440);
  if (days > 0) return `${days} дн.`;
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`;
}

export function liveWidgetTarget(config: LiveWidgetConfig) {
  if (config.type === "HTTP_STATUS" || config.type === "JSON_VALUE") return config.url;
  if (config.type === "TCP_CHECK") return `${config.host}:${config.port}`;
  if (config.type === "TLS_CERTIFICATE") return `${config.hostname}:${config.port}`;
  if (config.type === "DATETIME") return config.timeZone;
  return config.targetAt;
}

export function sanitizeLiveWidgetError(error: unknown) {
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : 0;
  if (status === 403) return "Заблокировано сетевой политикой";
  const code = error instanceof Error ? error.message : "";
  if (code.includes("TIMEOUT")) return "Превышено время ожидания";
  if (code.includes("TOO_MANY_REDIRECTS")) return "Слишком много перенаправлений";
  if (code.includes("RESPONSE_TOO_LARGE")) return "Ответ превышает 256 КБ";
  if (code.includes("INVALID_JSON_PATH")) return "JSON path не найден";
  if (code.includes("JSON_VALUE_TOO_LARGE")) return "JSON value слишком большой";
  if (error instanceof SyntaxError) return "Ответ не является корректным JSON";
  if (code.includes("ENOTFOUND") || code.includes("EAI_AGAIN")) return "Ошибка DNS";
  if (code.includes("ECONNREFUSED")) return "Соединение отклонено";
  if (code.includes("ENETUNREACH") || code.includes("EHOSTUNREACH")) return "Сеть недоступна";
  if (code.includes("CERTIFICATE")) return "Ошибка сертификата";
  return "Проверка не выполнена";
}
