export const SECTION_ICONS = [
  "folder",
  "mail",
  "phone",
  "server",
  "shield",
  "network",
  "key",
  "finance",
  "document",
  "home",
  "work",
  "tool",
  "code",
  "globe",
  "users",
  "archive",
] as const;

export type SectionIconId = (typeof SECTION_ICONS)[number];

export function isSectionIcon(value: unknown): value is SectionIconId {
  return typeof value === "string" && SECTION_ICONS.includes(value as SectionIconId);
}

export function resolveSectionIcon(value: unknown): SectionIconId {
  return isSectionIcon(value) ? value : "folder";
}
