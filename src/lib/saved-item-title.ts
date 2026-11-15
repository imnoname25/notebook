import type { SavedItemTitleOrigin } from "@/generated/prisma/client";
import { savedHtmlAccessLabel } from "./saved-html-access";

export function savedItemTitleOriginsEnabled() {
  return process.env.SAVED_ITEM_TITLE_ORIGINS === "1";
}

export function websiteTitle(value: string | null) {
  const title = value?.trim() || "";
  return savedHtmlAccessLabel(title) ? "" : title;
}

function automaticShareTitle(value: string | null) {
  const title = websiteTitle(value);
  return /[\p{L}\p{N}]{6}|[\p{L}\p{N}]+\s+[\p{L}\p{N}]+/u.test(title)
    && !/(?:…|\.{3})$/u.test(title) && !/^https?:\/\//iu.test(title) ? title : "";
}

export function resolveSavedItemTitle(item: {
  title: string;
  titleOrigin: SavedItemTitleOrigin;
  sharedTitle: string | null;
  metadataTitle: string | null;
  metadataSiteName?: string | null;
  metadataTitleSource?: string | null;
  text: string;
  url: string | null;
  fileName?: string | null;
  androidCapture?: boolean;
}) {
  let domain = "";
  if (item.url) {
    try { domain = new URL(item.url).hostname; } catch { /* Imported URL may be unavailable. */ }
  }
  const shared = item.androidCapture ? automaticShareTitle(item.sharedTitle) : item.sharedTitle;
  const metadata = websiteTitle(item.metadataTitle);
  const excerpt = item.androidCapture
    ? automaticShareTitle(item.text.replace(/https?:\/\/\S+/giu, "").trim().split(/\r?\n/u)[0]?.trim().slice(0, 100) ?? "")
    : item.text.trim().slice(0, 100);
  const bestTitle = item.androidCapture && item.metadataTitleSource === "html" ? shared || metadata : metadata || shared;
  const title = item.title || (!item.androidCapture && !savedItemTitleOriginsEnabled() && item.titleOrigin === "share" ? shared : "")
    || bestTitle || excerpt || (item.androidCapture ? item.metadataSiteName : "")
    || domain || item.fileName || "Сохранённый материал";
  return item.androidCapture ? title : title.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, "");
}
