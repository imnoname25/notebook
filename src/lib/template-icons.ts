export const TEMPLATE_ICONS = ["file-text", "notebook", "calendar", "list-checks", "book-open", "briefcase", "lightbulb"] as const;
export type TemplateIcon = (typeof TEMPLATE_ICONS)[number];
