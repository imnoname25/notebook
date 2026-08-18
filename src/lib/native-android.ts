type NotebookSessionPlugin = { flushCookies(): Promise<void> };
type CapacitorRuntime = {
  isNativePlatform?(): boolean;
  Plugins?: { NotebookSession?: NotebookSessionPlugin };
};

function capacitorRuntime() {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorRuntime }).Capacitor;
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
