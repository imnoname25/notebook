import { readFile } from "node:fs/promises";

const [config, gradle, app] = await Promise.all([
  readFile(new URL("../capacitor.config.ts", import.meta.url), "utf8"),
  readFile(new URL("../android/app/build.gradle", import.meta.url), "utf8"),
  readFile(new URL("../www/app.js", import.meta.url), "utf8"),
]);
if (!config.includes('appId: "ru.metroom.notebook"')) throw new Error("Нестабильный package ID");
if (!gradle.includes("versionName \"0.2.0\"") || !gradle.includes("versionCode 2")) throw new Error("Android version не синхронизирована");
if (!app.includes('/api/health/live')) throw new Error("Нет проверки совместимости сервера");
if (!app.includes("SUPPORTED_SERVER_API_VERSION = 1")) throw new Error("Версия server API не зафиксирована");
if (!app.includes('import { normalizeServerUrl }')) throw new Error("Server URL validation отсутствует");
console.log("Android client contract is valid");
