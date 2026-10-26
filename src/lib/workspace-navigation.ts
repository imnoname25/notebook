export const WORKSPACE_ROOT_HREF = "/app";

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

