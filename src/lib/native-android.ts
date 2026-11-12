import { androidAppInfoSchema } from "./android-app-info";

type NotebookSessionPlugin = { flushCookies(): Promise<void> };
type NotebookSharePlugin = { showQueue?(): Promise<void> };
type CapacitorRuntime = {
  isNativePlatform?(): boolean;
  Plugins?: { NotebookSession?: NotebookSessionPlugin; NotebookShare?: NotebookSharePlugin; NotebookAppInfo?: { getInfo(): Promise<unknown> } };
};

function capacitorRuntime() {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorRuntime }).Capacitor;
}

export function hasNativeShareQueue() {
  const runtime = capacitorRuntime();
  return Boolean(runtime?.isNativePlatform?.() && typeof runtime.Plugins?.NotebookShare?.showQueue === "function");
}

export async function openNativeShareQueue() {
  const runtime = capacitorRuntime();
  const plugin = runtime?.Plugins?.NotebookShare;
  if (!runtime?.isNativePlatform?.() || !plugin?.showQueue) return;
  await plugin.showQueue();
}

export function isNativeAndroidClient() {
  return Boolean(capacitorRuntime()?.isNativePlatform?.());
}

export async function readNativeAndroidAppInfo() {
  const plugin = capacitorRuntime()?.Plugins?.NotebookAppInfo;
  if (!plugin) return null;
  try {
    const info = androidAppInfoSchema.safeParse(await plugin.getInfo());
    return info.success ? info.data : null;
  } catch { return null; }
}

export async function flushNativeAuthCookies() {
  const plugin = capacitorRuntime()?.Plugins?.NotebookSession;
  if (!plugin) return;
  try {
    await plugin.flushCookies();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.debug("NotebookSession: cookie flush failed", error);
  }
}
