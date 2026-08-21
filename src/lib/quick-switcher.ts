import type { SearchResult } from "./services/search-service";

export function rankQuickSwitcherResults(results: SearchResult[], query: string, recentIds: ReadonlySet<string>, favoriteIds: ReadonlySet<string>) {
  const normalized = query.trim().toLocaleLowerCase("ru");
  return results.map((result, index) => ({ result, index, score: result.title.toLocaleLowerCase("ru") === normalized ? 4 : recentIds.has(result.id) ? 3 : favoriteIds.has(result.id) ? 2 : 1 }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ result }) => result);
}
