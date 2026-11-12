import { afterEach, describe, expect, it, vi } from "vitest";
import { flushNativeAuthCookies, hasNativeShareQueue, isNativeAndroidClient, openNativeShareQueue } from "./native-android";

type TestGlobal = typeof globalThis & { Capacitor?: unknown };

afterEach(() => {
  delete (globalThis as TestGlobal).Capacitor;
});

describe("native Android session bridge", () => {
  it("flushes the WebView cookie store after an auth transition", async () => {
    const flushCookies = vi.fn().mockResolvedValue({ flushed: true });
    (globalThis as TestGlobal).Capacitor = {
      isNativePlatform: () => true,
      Plugins: { NotebookSession: { flushCookies } },
    };

    expect(isNativeAndroidClient()).toBe(true);
    await flushNativeAuthCookies();
    expect(flushCookies).toHaveBeenCalledOnce();
  });

  it("is a no-op in a regular browser", async () => {
    expect(isNativeAndroidClient()).toBe(false);
    await expect(flushNativeAuthCookies()).resolves.toBeUndefined();
  });

  it("only asks Android to open its native queue and passes no material", async () => {
    const showQueue = vi.fn().mockResolvedValue(undefined);
    (globalThis as TestGlobal).Capacitor = {
      isNativePlatform: () => true, Plugins: { NotebookShare: { showQueue } },
    };
    expect(hasNativeShareQueue()).toBe(true);
    await openNativeShareQueue();
    expect(showQueue).toHaveBeenCalledExactlyOnceWith();
  });
});
