import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android and mobile shell contract", () => {
  it("configures native status bars and safe-area fallbacks", () => {
    const config = readFileSync("android-client/capacitor.config.ts", "utf8");
    const shell = readFileSync("android-client/www/app.js", "utf8");
    const styles = readFileSync("src/app/globals.css", "utf8");
    expect(config).toContain("overlaysWebView: false");
    expect(config).toContain('insetsHandling: "css"');
    expect(shell).toContain("StatusBar.setOverlaysWebView({ overlay: false })");
    expect(styles).toContain("var(--safe-area-inset-top, env(safe-area-inset-top, 0px))");
  });

  it("keeps secondary actions out of the mobile header", () => {
    const mobileHeader = readFileSync("src/components/notebook/mobile-app-header.tsx", "utf8");
    const header = mobileHeader.match(/<header[\s\S]*?<\/header>/)?.[0];
    expect(header).toBeTruthy();
    expect(header).toContain("Открыть навигацию");
    expect(header).toContain('aria-label="Поиск"');
    expect(header).toContain('aria-label="Ещё"');
    expect(header).not.toContain("ShieldCheck");
    expect(header).not.toContain("Settings");
    const activity = readFileSync("android-client/android/app/src/main/java/ru/metroom/notebook/MainActivity.java", "utf8");
    const shell = readFileSync("android-client/www/app.js", "utf8");
    expect(activity).not.toContain(".canGoBack()");
    expect(activity).not.toContain(".goBack()");
    expect(activity).toContain("__NOTEBOOK_ANDROID_BACK__");
    expect(activity).toContain('private static final String HANDLED = "HANDLED"');
    expect(activity).toContain("UNHANDLED");
    expect(activity).toContain("JSONTokener");
    expect(activity).toContain("NotebookSessionPlugin.class");
    expect(activity).toContain("CookieManager.getInstance().flush()");
    expect(shell).toContain("window.location.replace(notebookUrl(server))");
    expect(shell).toContain('get("changeServer") === "1"');
    expect(mobileHeader).toContain("Выйти на всех устройствах");
  });

  it("persists and flushes the HttpOnly server session without storing credentials", () => {
    const session = readFileSync("src/lib/auth/session.ts", "utf8");
    const login = readFileSync("src/components/auth/login-form.tsx", "utf8");
    const nativeBridge = readFileSync("src/lib/native-android.ts", "utf8");
    expect(session).toContain("httpOnly: true");
    expect(session).toContain("expires: absoluteExpiresAt");
    expect(session).toContain("maxAge: sessionCookieMaxAgeSeconds");
    expect(login).toContain("await flushNativeAuthCookies()");
    expect(nativeBridge).toContain("NotebookSession");
    expect(nativeBridge).not.toContain("localStorage");
    expect(nativeBridge).not.toContain("password");
  });

  it("keeps quick capture and tag sheets inside the handled mobile overlay boundary", () => {
    const app = readFileSync("src/components/notebook/notebook-app.tsx", "utf8");
    const stickers = readFileSync("src/components/notebook/quick-notes.tsx", "utf8");
    const navigation = readFileSync("src/lib/mobile-navigation.ts", "utf8");
    expect(app).toContain("state.quickNotesOpen");
    expect(app).toContain("setQuickNotesOpen(false)");
    expect(app).toContain("state.tagBrowserOpen");
    expect(app).toContain("setTagBrowserOpen(false)");
    expect(app).toContain('openSpecial("stickers")');
    expect(navigation).toContain('state.screen !== "workspace"');
    expect(app).toContain("state.editorOverlayOpen");
    expect(stickers).toContain('new CustomEvent("notebook:editor-overlay"');
    expect(stickers).toContain('"notebook:close-editor-overlay"');
  });

  it("opens explicitly shared Android text in Quick Capture without persisting it natively", () => {
    const activity = readFileSync("android-client/android/app/src/main/java/ru/metroom/notebook/MainActivity.java", "utf8");
    const manifest = readFileSync("android-client/android/app/src/main/AndroidManifest.xml", "utf8");
    const plugin = readFileSync("android-client/android/app/src/main/java/ru/metroom/notebook/NotebookSharePlugin.java", "utf8");
    expect(activity).toContain("Intent.ACTION_SEND");
    expect(activity).toContain("NotebookSharePlugin.setPending");
    expect(activity).not.toContain("Log.d(BACK_TAG, text");
    expect(manifest).toContain('android.intent.action.SEND');
    expect(manifest).toContain('android:mimeType="text/plain"');
    expect(plugin).toContain("pendingText = null");
    expect(plugin).not.toContain("SharedPreferences");
  });
});
