import { androidAppInfoSchema } from "./android-app-info";

type NotebookSessionPlugin = { flushCookies(): Promise<void> };
type NotebookSharePlugin = { consume(): Promise<{ text?: string; title?: string }> };
type CapacitorRuntime = {
  isNativePlatform?(): boolean;
  Plugins?: { NotebookSession?: NotebookSessionPlugin; NotebookShare?: NotebookSharePlugin; NotebookAppInfo?: { getInfo(): Promise<unknown> } };
};

function capacitorRuntime() {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorRuntime }).Capacitor;
}

export async function consumeNativeShare() {
  const plugin = capacitorRuntime()?.Plugins?.NotebookShare;
  if (!plugin) return null;
  try {
    const value = await plugin.consume();
    return value.text?.trim() ? { text: value.text, title: value.title?.trim() ?? "" } : null;
  } catch {
    return null;
  }
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
