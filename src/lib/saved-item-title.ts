import type { SavedItemTitleOrigin } from "@/generated/prisma/client";
import { savedHtmlAccessLabel } from "./saved-html-access";

export function savedItemTitleOriginsEnabled() {
  return process.env.SAVED_ITEM_TITLE_ORIGINS === "1";
}

export function websiteTitle(value: string | null) {
  const title = value?.trim() || "";
  return savedHtmlAccessLabel(title) ? "" : title;
}

export function resolveSavedItemTitle(item: {
  title: string;
  titleOrigin: SavedItemTitleOrigin;
  sharedTitle: string | null;
  metadataTitle: string | null;
  text: string;
  url: string | null;
  fileName?: string | null;
}) {
  let domain = "";
  if (item.url) {
    try { domain = new URL(item.url).hostname; } catch { /* Imported URL may be unavailable. */ }
  }
  const title = item.title || (!savedItemTitleOriginsEnabled() && item.titleOrigin === "share" ? item.sharedTitle : "")
    || websiteTitle(item.metadataTitle) || item.sharedTitle || item.text.trim().slice(0, 100)
    || domain || item.fileName || "Сохранённый материал";
  return title.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, "");
}
