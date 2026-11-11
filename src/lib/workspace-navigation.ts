export const WORKSPACE_ROOT_HREF = "/app";

export function savedHref(id: string | null = null) {
  return id ? `/app?view=saved&item=${encodeURIComponent(id)}` : "/app?view=saved";
}

export function savedFromUrl(value: string) {
  const url = new URL(value, "http://notebook.invalid");
  if (url.pathname !== "/app" || url.searchParams.get("view") !== "saved") return null;
  const id = url.searchParams.get("item");
  return { id: id && /^[a-zA-Z0-9_-]{1,128}$/u.test(id) ? id : null };
}

export function getPageHref(pageId: string, blockId?: string) {
  const base = `/pages/${encodeURIComponent(pageId)}`;
  return blockId ? `${base}#block=${encodeURIComponent(blockId)}` : base;
}

export function pageIdFromPath(pathname: string) {
  const match = pathname.match(/^\/pages\/([^/]+)$/u);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export function blockIdFromHash(hash: string) {
  const value = hash.match(/^#block=(.+)$/u)?.[1];
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return null; }
}

