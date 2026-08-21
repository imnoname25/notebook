import { describe, expect, it } from "vitest";
import { compactJsonValue, formatCountdown, liveWidgetConfigSchema, readJsonPath, sanitizeLiveWidgetError, tlsDaysRemaining } from "./live-widgets";

describe("Live Widget config and local values", () => {
  it("allows typed checks but rejects protocols, credentials and port ranges", () => {
    expect(liveWidgetConfigSchema.parse({ type: "HTTP_STATUS", url: "https://example.com/health" })).toMatchObject({ type: "HTTP_STATUS", method: "HEAD" });
    expect(() => liveWidgetConfigSchema.parse({ type: "HTTP_STATUS", url: "file:///etc/passwd" })).toThrow();
    expect(() => liveWidgetConfigSchema.parse({ type: "HTTP_STATUS", url: "https://user:pass@example.com" })).toThrow();
    expect(() => liveWidgetConfigSchema.parse({ type: "TCP_CHECK", host: "example.com", port: "1-100" })).toThrow();
  });
  it("reads only simple JSON paths and bounds previews", () => {
    expect(readJsonPath({ data: { items: [{ name: "ok" }] } }, "data.items.0.name")).toBe("ok");
    expect(() => readJsonPath({}, "missing.value")).toThrow("INVALID_JSON_PATH");
    expect(compactJsonValue({ ok: true })).toBe('{"ok":true}');
    expect(() => compactJsonValue({ value: "x".repeat(1100) })).toThrow("JSON_VALUE_TOO_LARGE");
  });
  it("calculates TLS and countdown values deterministically", () => {
    expect(tlsDaysRemaining("2026-02-01T00:00:00Z", new Date("2026-01-01T00:00:00Z"))).toBe(31);
    expect(formatCountdown("2026-01-03T03:24:00Z", new Date("2026-01-01T00:00:00Z"))).toBe("2 дн.");
    expect(formatCountdown("2025-01-01T00:00:00Z", new Date("2026-01-01T00:00:00Z"))).toBe("Истекло");
  });
  it("sanitizes operational failures without exposing raw details", () => {
    expect(sanitizeLiveWidgetError(new Error("connect ECONNREFUSED 10.0.0.5:22"))).toBe("Соединение отклонено");
    expect(sanitizeLiveWidgetError(new Error("secret internal stack"))).toBe("Проверка не выполнена");
  });
});
