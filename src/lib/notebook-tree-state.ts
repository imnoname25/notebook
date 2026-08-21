export function toggleExpandedNotebook(
  expandedIds: Iterable<string>,
  notebookId: string,
) {
  const next = new Set(expandedIds);
  if (next.has(notebookId)) next.delete(notebookId);
  else next.add(notebookId);
  return next;
}

export function ensureExpandedNotebook(
  expandedIds: Iterable<string>,
  notebookId: string,
) {
  return new Set([...expandedIds, notebookId]);
}
