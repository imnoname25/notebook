import { normalizeServerUrl } from "./server-url.js";

const CURRENT_VERSION = "0.2.0";
const SUPPORTED_SERVER_API_VERSION = 1;
const input = document.querySelector("#server");
const button = document.querySelector("#connect");
const status = document.querySelector("#status");
const warning = document.querySelector("#warning");
const isNewerVersion = (candidate, current) => candidate.split(".").map(Number).some((value, index, parts) => value > (current.split(".").map(Number)[index] || 0) && parts.slice(0, index).every((part, previous) => part === (current.split(".").map(Number)[previous] || 0)));

input.value = localStorage.getItem("notebook.serverUrl") || "";
input.addEventListener("input", () => { try { warning.hidden = new URL(input.value).protocol !== "http:"; } catch { warning.hidden = true; } });
input.dispatchEvent(new Event("input"));

button.addEventListener("click", async () => {
  button.disabled = true; status.textContent = "Проверяем сервер…";
  try {
    const server = normalizeServerUrl(input.value);
    const response = await fetch(`${server}/api/health/live`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Сервер ответил с кодом ${response.status}`);
    const health = await response.json();
    if (health.app !== "Notebook" || health.status !== "ok" || typeof health.version !== "string" || health.apiVersion !== SUPPORTED_SERVER_API_VERSION) throw new Error("Сервер несовместим с приложением Notebook");
    localStorage.setItem("notebook.serverUrl", server);
    status.textContent = "Подключено. Открываем Notebook…";
    const navigation = document.createElement("a"); navigation.href = `${server}/app?client=android&version=${encodeURIComponent(CURRENT_VERSION)}`; navigation.target = "_self"; navigation.click();
  } catch (error) { status.textContent = error instanceof Error ? error.message : "Не удалось подключиться к серверу"; button.disabled = false; }
});

void fetch("https://api.github.com/repos/imnoname25/notebook/releases/latest", { headers: { Accept: "application/vnd.github+json" } }).then((response) => response.ok ? response.json() : null).then((release) => {
  const latest = release?.tag_name?.replace(/^v/, "");
  const apk = release?.assets?.find((asset) => /^Notebook-.*\.apk$/.test(asset.name));
  if (!latest || !apk || !isNewerVersion(latest, CURRENT_VERSION)) return;
  document.querySelector("#updateText").textContent = `Доступна версия ${latest}`;
  const link = document.querySelector("#download"); link.href = apk.browser_download_url;
  document.querySelector("#update").hidden = false;
}).catch(() => undefined);
