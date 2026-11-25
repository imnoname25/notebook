export function parseSmartPasteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /\s/u.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return null;
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
