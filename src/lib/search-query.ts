/** Prefix completion applies only to plain words, never to websearch operators/phrases. */
export function isSimplePrefixSearch(query: string) {
  const terms = query.trim().split(/\s+/u);
  return terms.every(term => /^[\p{L}\p{N}_]{2,}$/u.test(term) && term.toLowerCase() !== "or");
}
