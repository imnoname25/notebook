import { readFile } from "node:fs/promises";

const [config, gradle, app, activity, sessionPlugin, manifest, packageJson] = await Promise.all([
  readFile(new URL("../capacitor.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8"),
  readFile(new URL("../www/app.js", import.meta.url), "utf8"),
  readFile(new URL("../android/app/src/main/java/ru/metroom/notebook/MainActivity.java", import.meta.url), "utf8"),
  readFile(new URL("../android/app/src/main/java/ru/metroom/notebook/NotebookSessionPlugin.java", import.meta.url), "utf8"),
  readFile(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
]);
if (!config.includes('appId: "ru.metroom.notebook"')) throw new Error("Нестабильный package ID");
if (!gradle.includes("versionName \"0.2.0\"") || !gradle.includes("versionCode 2")) throw new Error("Android version не синхронизирована");
if (!app.includes('/api/health/live')) throw new Error("Нет проверки совместимости сервера");
if (!app.includes("SUPPORTED_SERVER_API_VERSION = 1")) throw new Error("Версия server API не зафиксирована");
if (!app.includes('import { normalizeServerUrl }')) throw new Error("Server URL validation отсутствует");
if (packageJson.dependencies?.["@capacitor/status-bar"] !== "^8.0.0") throw new Error("Capacitor StatusBar plugin не зафиксирован");
if (!config.includes("overlaysWebView: false")) throw new Error("Status bar overlay должен быть отключён в native config");
if (!config.includes('insetsHandling: "css"')) throw new Error("Android edge-to-edge insets должны экспортироваться в CSS");
if (!app.includes("StatusBar.setOverlaysWebView({ overlay: false })")) throw new Error("Status bar overlay должен отключаться при запуске shell");
if (!app.includes("window.location.replace(notebookUrl(server))")) throw new Error("Server chooser must be replaced after successful bootstrap");
if (!app.includes('get("changeServer") === "1"')) throw new Error("Server chooser must require initial setup or an explicit change action");
if (activity.includes(".canGoBack()") || activity.includes(".goBack()")) throw new Error("Android Back must not traverse raw WebView/bootstrap history");
if (!activity.includes("__NOTEBOOK_ANDROID_BACK__") || !activity.includes("evaluateJavascript")) throw new Error("Native/WebView Back contract is missing");
if (!activity.includes('private static final String HANDLED = "HANDLED"') || !activity.includes("UNHANDLED") || !activity.includes("JSONTokener")) throw new Error("Android Back must use the explicit HANDLED/UNHANDLED result protocol");
if (!activity.includes("getOnBackPressedDispatcher().onBackPressed()")) throw new Error("Root Back must be delegated to the Android dispatcher");
if (!activity.includes("NotebookSessionPlugin.class") || !sessionPlugin.includes("CookieManager.getInstance().flush()")) throw new Error("Persistent WebView cookies must be flushed through the native session bridge");
if (!manifest.includes('android:enableOnBackInvokedCallback="true"')) throw new Error("Predictive Back must remain enabled");
console.log("Android client contract is valid");
