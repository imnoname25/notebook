import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { performance } from "node:perf_hooks";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { compactJsonValue, liveWidgetConfigSchema, liveWidgetPropsSchema, readJsonPath, sanitizeLiveWidgetError, tlsDaysRemaining, type LiveWidgetConfig, type LiveWidgetSafeResult } from "@/lib/live-widgets";
import { resolveAllowedAddresses, validateRedirectTarget } from "@/lib/live-widget-network-policy";
import { getApplicationSettings } from "./settings-service";

const MAX_JSON_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const widgetAttempts = new Map<string, number>();
const userAttempts = new Map<string, number[]>();

function assertRateLimit(userId: string, widgetId: string) {
  const now = Date.now();
  if (now - (widgetAttempts.get(widgetId) ?? 0) < 5_000) throw new ApiError(429, "Подождите перед повторной проверкой");
  const recent = (userAttempts.get(userId) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 30) throw new ApiError(429, "Слишком много проверок Live Widgets");
  widgetAttempts.set(widgetId, now); userAttempts.set(userId, [...recent, now]);
}

type HttpResult = { statusCode: number; statusMessage: string; body: Buffer; latencyMs: number; location?: string };
async function requestPinned(url: URL, method: "HEAD" | "GET", allowedCidrs: string, maxBytes: number, redirects = 0): Promise<HttpResult> {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new ApiError(400, "Разрешён только HTTP(S) URL без credentials");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await resolveAllowedAddresses(hostname, allowedCidrs);
  const target = addresses[0]!;
  const transport = url.protocol === "https:" ? https : http;
  const started = performance.now();
  const result = await new Promise<HttpResult>((resolve, reject) => {
    const request = transport.request(url, {
      method,
      timeout: 7_000,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
      headers: { accept: "application/json, */*;q=0.1", "user-agent": "Notebook-LiveWidget/1" },
    }, (response) => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        if (maxBytes === 0) return;
        size += chunk.length;
        if (size > maxBytes) { request.destroy(new Error("RESPONSE_TOO_LARGE")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, statusMessage: response.statusMessage ?? "", body: Buffer.concat(chunks), latencyMs: Math.round(performance.now() - started), location: response.headers.location }));
    });
    const absoluteTimeout = setTimeout(() => request.destroy(new Error("TIMEOUT")), 7_000);
    request.once("close", () => clearTimeout(absoluteTimeout));
    request.on("timeout", () => request.destroy(new Error("TIMEOUT")));
    request.on("error", reject);
    request.end();
  });
  if ([301, 302, 303, 307, 308].includes(result.statusCode) && result.location) {
    if (redirects >= MAX_REDIRECTS) throw new Error("TOO_MANY_REDIRECTS");
    return requestPinned(await validateRedirectTarget(url, result.location, allowedCidrs), method, allowedCidrs, maxBytes, redirects + 1);
  }
  return result;
}

async function tcpCheck(config: Extract<LiveWidgetConfig, { type: "TCP_CHECK" }>, allowedCidrs: string) {
  const target = (await resolveAllowedAddresses(config.host, allowedCidrs))[0]!;
  const started = performance.now();
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: target.address, port: config.port, timeout: config.timeoutMs });
    socket.once("connect", () => { socket.destroy(); resolve(); });
    socket.once("timeout", () => socket.destroy(new Error("TIMEOUT")));
    socket.once("error", reject);
  });
  return Math.round(performance.now() - started);
}

async function tlsCheck(config: Extract<LiveWidgetConfig, { type: "TLS_CERTIFICATE" }>, allowedCidrs: string) {
  const target = (await resolveAllowedAddresses(config.hostname, allowedCidrs))[0]!;
  const started = performance.now();
  return new Promise<{ latencyMs: number; validTo: string; authorized: boolean }>((resolve, reject) => {
    const socket = tls.connect({ host: target.address, port: config.port, servername: net.isIP(config.hostname) ? undefined : config.hostname, rejectUnauthorized: false, timeout: config.timeoutMs }, () => {
      const certificate = socket.getPeerCertificate();
      const result = { latencyMs: Math.round(performance.now() - started), validTo: certificate.valid_to, authorized: socket.authorized };
      socket.destroy();
      if (!certificate.valid_to) reject(new Error("CERTIFICATE_ERROR")); else resolve(result);
    });
    socket.once("timeout", () => socket.destroy(new Error("TIMEOUT")));
    socket.once("error", reject);
  });
}

async function execute(config: LiveWidgetConfig, allowedCidrs: string): Promise<Omit<LiveWidgetSafeResult, "checkedAt"> & { resultData?: Prisma.InputJsonValue }> {
  if (config.type === "HTTP_STATUS") {
    // Status checks intentionally discard the response body. Only JSON_VALUE is
    // allowed to buffer a bounded payload.
    const response = await requestPinned(new URL(config.url), config.method, allowedCidrs, 0);
    const expected = response.statusCode >= config.expectedMin && response.statusCode <= config.expectedMax;
    return { status: expected ? "ONLINE" : "WARNING", value: expected ? "Работает" : `HTTP ${response.statusCode}`, detail: `${response.statusCode} ${response.statusMessage}`.trim(), latencyMs: response.latencyMs, resultData: { statusCode: response.statusCode } };
  }
  if (config.type === "JSON_VALUE") {
    const response = await requestPinned(new URL(config.url), "GET", allowedCidrs, MAX_JSON_BYTES);
    if (response.statusCode < 200 || response.statusCode >= 300) return { status: "WARNING", value: `HTTP ${response.statusCode}`, latencyMs: response.latencyMs };
    const value = compactJsonValue(readJsonPath(JSON.parse(response.body.toString("utf8")), config.path));
    return { status: "ONLINE", value, detail: config.label || config.path, latencyMs: response.latencyMs };
  }
  if (config.type === "TCP_CHECK") {
    const latencyMs = await tcpCheck(config, allowedCidrs);
    return { status: "ONLINE", value: "Работает", detail: `${config.host}:${config.port}`, latencyMs };
  }
  if (config.type === "TLS_CERTIFICATE") {
    const result = await tlsCheck(config, allowedCidrs);
    const days = tlsDaysRemaining(result.validTo);
    const status = days < 0 || !result.authorized ? "OFFLINE" : days <= 30 ? "WARNING" : "ONLINE";
    return { status, value: days < 0 ? "Истёк" : `${days} дн.`, detail: `Действителен до ${new Date(result.validTo).toLocaleDateString("ru")}`, latencyMs: result.latencyMs, resultData: { validTo: result.validTo, daysRemaining: days } };
  }
  throw new ApiError(400, "Локальный widget не требует server refresh");
}

export async function syncLiveWidgetIndex(tx: Prisma.TransactionClient, pageId: string, content: unknown) {
  const widgets: Array<{ blockId: string; parsed: ReturnType<typeof liveWidgetPropsSchema.parse> }> = [];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const raw of value) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as Record<string, unknown>;
      if (block.type === "liveWidget" && typeof block.id === "string") widgets.push({ blockId: block.id, parsed: liveWidgetPropsSchema.parse(block.props) });
      visit(block.children);
    }
  };
  visit(content);
  const existing = await tx.liveWidgetIndex.findMany({ where: { pageId }, select: { id: true, blockId: true, type: true, title: true, config: true, refreshMode: true, displaySize: true } });
  const keep = new Set(widgets.map((widget) => widget.blockId));
  await tx.liveWidgetIndex.deleteMany({ where: keep.size ? { pageId, blockId: { notIn: [...keep] } } : { pageId } });
  for (const widget of widgets) {
    const data = { type: widget.parsed.widgetType, title: widget.parsed.title, config: widget.parsed.config as Prisma.InputJsonValue, refreshMode: widget.parsed.refreshMode, displaySize: widget.parsed.displaySize };
    const prior = existing.find((item) => item.blockId === widget.blockId);
    const changed = !prior || prior.type !== data.type || prior.title !== data.title || prior.refreshMode !== data.refreshMode || prior.displaySize !== data.displaySize || JSON.stringify(prior.config) !== JSON.stringify(data.config);
    const saved = await tx.liveWidgetIndex.upsert({ where: { pageId_blockId: { pageId, blockId: widget.blockId } }, create: { pageId, blockId: widget.blockId, ...data }, update: data, select: { id: true } });
    if (changed) await tx.liveWidgetResult.deleteMany({ where: { widgetId: saved.id } });
  }
}

async function ownedWidget(userId: string, pageId: string, blockId: string) {
  const widget = await db.liveWidgetIndex.findFirst({ where: { pageId, blockId, page: { deletedAt: null, section: { deletedAt: null, notebook: { userId, deletedAt: null } } } }, include: { result: true } });
  if (!widget) throw new ApiError(404, "Live Widget не найден");
  return widget;
}

export function publicLiveWidgetResult(result: { status: string; value: string; detail: string | null; latencyMs: number | null; checkedAt: Date } | null): LiveWidgetSafeResult {
  if (!result) return { status: "UNKNOWN", value: "Неизвестно", checkedAt: "" };
  return { status: result.status as LiveWidgetSafeResult["status"], value: result.value, ...(result.detail ? { detail: result.detail } : {}), ...(result.latencyMs !== null ? { latencyMs: result.latencyMs } : {}), checkedAt: result.checkedAt.toISOString() };
}

export async function getLiveWidgetResult(userId: string, pageId: string, blockId: string) {
  return publicLiveWidgetResult((await ownedWidget(userId, pageId, blockId)).result);
}

export async function refreshLiveWidget(userId: string, pageId: string, blockId: string) {
  const widget = await ownedWidget(userId, pageId, blockId);
  assertRateLimit(userId, widget.id);
  const config = liveWidgetConfigSchema.parse(widget.config);
  const checkedAt = new Date();
  try {
    const result = await execute(config, (await getApplicationSettings()).liveWidgetAllowedCidrs);
    const saved = await db.liveWidgetResult.upsert({ where: { widgetId: widget.id }, create: { widgetId: widget.id, checkedAt, status: result.status, value: result.value, detail: result.detail, latencyMs: result.latencyMs, resultData: result.resultData }, update: { checkedAt, status: result.status, value: result.value, detail: result.detail, latencyMs: result.latencyMs, resultData: result.resultData } });
    return publicLiveWidgetResult(saved);
  } catch (error) {
    const detail = sanitizeLiveWidgetError(error);
    const saved = await db.liveWidgetResult.upsert({ where: { widgetId: widget.id }, create: { widgetId: widget.id, checkedAt, status: "OFFLINE", value: "Недоступен", detail }, update: { checkedAt, status: "OFFLINE", value: "Недоступен", detail, latencyMs: null, resultData: undefined } });
    return publicLiveWidgetResult(saved);
  }
}
