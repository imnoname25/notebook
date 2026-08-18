import { normalizeServerUrl } from "./server-url.js";

async function configureStatusBar() {
  const StatusBar = globalThis.Capacitor?.Plugins?.StatusBar;
  if (!StatusBar) return;
  const dark = globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  await StatusBar.setOverlaysWebView({ overlay: false });
  await StatusBar.setStyle({ style: dark ? "DARK" : "LIGHT" });
  await StatusBar.setBackgroundColor({ color: dark ? "#18181b" : "#fafafa" });
}

void configureStatusBar().catch(() => {
  // CSS safe-area insets remain the fallback on enforced edge-to-edge Android versions.
});

const CURRENT_VERSION = "0.2.0";
const SUPPORTED_SERVER_API_VERSION = 1;
const STORAGE_KEY = "notebook.serverUrl";
const input = document.querySelector("#server");
const button = document.querySelector("#connect");
const status = document.querySelector("#status");
const warning = document.querySelector("#warning");
const chooser = document.querySelector("#chooser");
const bootstrap = document.querySelector("#bootstrap");
const bootstrapStatus = document.querySelector("#bootstrapStatus");
const retry = document.querySelector("#retry");
const change = document.querySelector("#change");
const isNewerVersion = (candidate, current) => candidate.split(".").map(Number).some((value, index, parts) => value > (current.split(".").map(Number)[index] || 0) && parts.slice(0, index).every((part, previous) => part === (current.split(".").map(Number)[previous] || 0)));

function notebookUrl(server) {
  return `${server}/app?client=android&version=${encodeURIComponent(CURRENT_VERSION)}`;
}

function showChooser(message = "") {
  bootstrap.hidden = true;
  chooser.hidden = false;
  status.textContent = message;
  input.focus();
}

function showBootstrap(message) {
  chooser.hidden = true;
  bootstrap.hidden = false;
  bootstrapStatus.textContent = message;
}

async function validateServer(value) {
  const server = normalizeServerUrl(value);
  const response = await fetch(`${server}/api/health/live`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Сервер ответил с кодом ${response.status}`);
  const health = await response.json();
  if (health.app !== "Notebook" || health.status !== "ok" || typeof health.version !== "string" || health.apiVersion !== SUPPORTED_SERVER_API_VERSION) throw new Error("Сервер несовместим с приложением Notebook");
  return server;
}

async function connect(value, automatic = false) {
  if (automatic) showBootstrap("Проверяем сохранённый сервер…");
  else { button.disabled = true; status.textContent = "Проверяем сервер…"; }
  try {
    const server = await validateServer(value);
    localStorage.setItem(STORAGE_KEY, server);
    if (automatic) showBootstrap("Подключено. Открываем Notebook…");
    else status.textContent = "Подключено. Открываем Notebook…";
    // Bootstrap configuration must never become a Notebook Back destination.
    window.location.replace(notebookUrl(server));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось подключиться к серверу";
    if (automatic) showBootstrap(`${message}. Повторите попытку или явно смените сервер.`);
    else { status.textContent = message; button.disabled = false; }
  }
}

input.value = localStorage.getItem(STORAGE_KEY) || "";
input.addEventListener("input", () => {
  try { warning.hidden = new URL(input.value).protocol !== "http:"; }
  catch { warning.hidden = true; }
});
input.dispatchEvent(new Event("input"));
button.addEventListener("click", () => void connect(input.value));
retry.addEventListener("click", () => void connect(localStorage.getItem(STORAGE_KEY) || "", true));
change.addEventListener("click", () => {
  if (globalThis.confirm("Открыть выбор сервера Notebook?")) showChooser();
});

const explicitChange = new URLSearchParams(window.location.search).get("changeServer") === "1";
const savedServer = localStorage.getItem(STORAGE_KEY);
if (savedServer && !explicitChange) void connect(savedServer, true);
else showChooser();

void fetch("https://api.github.com/repos/imnoname25/notebook/releases/latest", { headers: { Accept: "application/vnd.github+json" } }).then((response) => response.ok ? response.json() : null).then((release) => {
  const latest = release?.tag_name?.replace(/^v/, "");
  const apk = release?.assets?.find((asset) => /^Notebook-.*\.apk$/.test(asset.name));
  if (!latest || !apk || !isNewerVersion(latest, CURRENT_VERSION)) return;
  document.querySelector("#updateText").textContent = `Доступна версия ${latest}`;
  const link = document.querySelector("#download"); link.href = apk.browser_download_url;
  document.querySelector("#update").hidden = false;
}).catch(() => undefined);
