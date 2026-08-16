export function normalizeServerUrl(value) {
  const url = new URL(value.trim());
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Разрешены только адреса HTTP или HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("Укажите только адрес сервера без параметров и пароля");
  return url.origin + url.pathname.replace(/\/$/, "");
}
