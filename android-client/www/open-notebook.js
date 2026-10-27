// A script navigation from the APK's https://localhost page is cross-site.
// Let Android initiate the navigation so persistent SameSite=Strict cookies apply.
export async function openNotebook(url, runtime = globalThis.Capacitor, replace = value => window.location.replace(value)) {
  if (runtime?.isNativePlatform?.()) {
    const plugin = runtime.Plugins?.NotebookSession;
    if (!plugin?.openNotebook) throw new Error("Native-переход недоступен. Обновите Android-приложение.");
    await plugin.openNotebook({ url });
    return;
  }
  replace(url);
}
