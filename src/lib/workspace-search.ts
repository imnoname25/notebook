import { z } from "zod";
import { hashtagQuery } from "./hashtags";

export const searchFiltersSchema = z.object({
  notebookId: z.string().max(100).default(""),
  sectionId: z.string().max(100).default(""),
  tag: z.string().trim().max(80).refine(value => !value || hashtagQuery(`#${value.replace(/^#/, "")}`) !== null, "Некорректный тег").default(""),
  dateFrom: z.union([z.literal(""), z.iso.date()]).default(""),
  dateTo: z.union([z.literal(""), z.iso.date()]).default(""),
  group: z.enum(["all", "favorites", "recent"]).default("all"),
});
export const workspaceSearchSchema = searchFiltersSchema.extend({ q: z.string().max(300).default("") });
export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>;
export const EMPTY_SEARCH = workspaceSearchSchema.parse({});
export function searchParams(state: WorkspaceSearch) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) if (value && !(key === "group" && value === "all")) params.set(key, value);
  return params;
}
export function searchHref(state: WorkspaceSearch) { return `/app?view=search&${searchParams(state)}`.replace(/&$/, ""); }
export function searchFromUrl(value: string): WorkspaceSearch | null {
  const url = new URL(value, "http://notebook.invalid");
  if (url.pathname !== "/app" || url.searchParams.get("view") !== "search") return null;
  const parsed = workspaceSearchSchema.safeParse(Object.fromEntries(url.searchParams));
  return parsed.success ? parsed.data : { ...EMPTY_SEARCH };
}
export function canSearch(state: WorkspaceSearch) {
  return state.q.trim().length >= 2 || (!state.q.trim() && Boolean(state.notebookId || state.sectionId || state.tag || state.dateFrom || state.dateTo || state.group !== "all"));
}
