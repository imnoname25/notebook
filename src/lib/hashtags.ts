export const HASHTAG_PATTERN = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}](?:[\p{L}\p{N}_-]{0,62}[\p{L}\p{N}_])?)/gu;
export const MAX_PAGE_TAGS = 50;

export function normalizeTag(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ru");
}

export function extractHashtags(value: string) {
  const tags = new Map<string, string>();
  for (const match of value.matchAll(HASHTAG_PATTERN)) {
    const name = match[2];
    if (!name) continue;
    const normalized = normalizeTag(name);
    if (!tags.has(normalized)) tags.set(normalized, name);
    if (tags.size >= MAX_PAGE_TAGS) break;
  }
  return [...tags].map(([normalized, name]) => ({ name, normalized }));
}

export function hashtagQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("#")) return null;
  const normalized = normalizeTag(trimmed.slice(1));
  return /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u.test(normalized)
    ? normalized
    : null;
}
