"use client";

import { useEffect, useState } from "react";
import { isNativeAndroidClient, readNativeAndroidAppInfo } from "@/lib/native-android";
import type { AndroidAppInfo as AppInfo } from "@/lib/android-app-info";

export function AndroidAppInfo() {
  const [state, setState] = useState<{ native: boolean; info: AppInfo | null } | null>(null);
  useEffect(() => {
    let disposed = false;
    const native = isNativeAndroidClient() || new URLSearchParams(window.location.search).get("client") === "android";
    if (!native) return;
    void readNativeAndroidAppInfo().then(info => { if (!disposed) setState({ native, info }); });
    return () => { disposed = true; };
  }, []);
  if (!state?.native) return null;
  return <section className="space-y-2 border-t border-border/60 pt-4 text-sm" aria-label="О версии Android">
    <h3 className="font-medium">Android-приложение Notebook</h3>
    {state.info ? <>
      <p>Версия: {state.info.versionName} ({state.info.versionCode}) · {state.info.debug ? "debug" : "release"}</p>
      <p className="break-all font-mono text-xs">Git: {state.info.gitCommit}</p>
      {state.info.sourceDirty && <p>Сборка содержит локальные изменения исходников.</p>}
    </> : <p>Эта Android-сборка не передаёт достоверные сведения о версии. Установите актуальный APK.</p>}
    <p className="text-xs leading-5 text-muted-foreground">Данные получены от Android-оболочки. Темы и вкладки загружаются с выбранного сервера; обновление APK не обновляет сервер.</p>
  </section>;
}
