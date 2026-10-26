export async function readNativeAppInfo(runtime = globalThis.Capacitor, timeoutMs = 2000) {
  const plugin = runtime?.Plugins?.NotebookAppInfo;
  if (!plugin) return null;
  let timer;
  try {
    const info = await Promise.race([plugin.getInfo(), new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
    if (!/^\d+\.\d+\.\d+(?:-g[0-9a-f]{8})?$/.test(info?.versionName ?? "") || !Number.isSafeInteger(info.versionCode) || info.versionCode < 1 || !/^[0-9a-f]{40}$/.test(info.gitCommit ?? "") || typeof info.sourceDirty !== "boolean" || typeof info.debug !== "boolean") return null;
    return info;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export function androidClientUrl(server, info) {
  const url = new URL(`${server}/app`);
  url.searchParams.set("client", "android");
  if (info) {
    url.searchParams.set("version", info.versionName.split("-")[0]);
    url.searchParams.set("clientCommit", info.gitCommit);
  }
  return url.toString();
}
