type NotebookSessionPlugin = { flushCookies(): Promise<void> };
type NotebookSharePlugin = { consume(): Promise<{ text?: string; title?: string }> };
type CapacitorRuntime = {
  isNativePlatform?(): boolean;
  Plugins?: { NotebookSession?: NotebookSessionPlugin; NotebookShare?: NotebookSharePlugin };
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

export async function flushNativeAuthCookies() {
  const plugin = capacitorRuntime()?.Plugins?.NotebookSession;
  if (!plugin) return;
  try {
    await plugin.flushCookies();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.debug("NotebookSession: cookie flush failed", error);
  }
}
