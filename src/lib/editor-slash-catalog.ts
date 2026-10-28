/** Presentation metadata only. BlockNote remains responsible for insertion and filtering. */
export const SLASH_GROUPS = ["Текст и заголовки", "Списки", "Информационные блоки", "Структура", "Медиа и ссылки", "Дополнительно"] as const;
type CommandMetadata = { title: string; group: number; order: number; aliases: string[] };
const entry = (title: string, group: number, order: number, ...aliases: string[]): CommandMetadata => ({ title, group, order, aliases });
export const SLASH_COMMANDS: Record<string, CommandMetadata> = {
  paragraph: entry("Обычный текст", 0, 0, "текст", "paragraph", "text"),
  ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => [level === 1 ? "heading" : `heading_${level}`, entry(`Заголовок H${level}`, 0, level, `h${level}`, `заголовок${level}`)])),
  quote: entry("Цитата", 0, 7, "цитата", "quote"),
  bullet_list: entry("Маркированный список", 1, 0, "список", "bullet"),
  numbered_list: entry("Нумерованный список", 1, 1, "список", "numbered"),
  check_list: entry("Чек-лист", 1, 2, "задачи", "чеклист", "todo"),
  toggle_list: entry("Сворачиваемый список", 1, 3, "свернуть", "toggle list"),
  "callout-info": entry("Информация", 2, 0, "информация", "info", "callout"),
  "callout-important": entry("Важно", 2, 1, "важно", "important"),
  "callout-warning": entry("Предупреждение", 2, 2, "предупреждение", "warning"),
  "callout-idea": entry("Идея", 2, 3, "идея", "idea"),
  "callout-note": entry("Совет", 2, 4, "совет", "note", "hint"),
  "callout-success": entry("Успех", 2, 5, "успех", "success"),
  "callout-error": entry("Ошибка", 2, 6, "ошибка", "error"),
  banner: entry("Баннер", 2, 7, "banner", "notice"),
  toggle: entry("Сворачиваемая группа", 3, 0, "группа", "toggle", "details", "свернуть"),
  "nested-group": entry("Группа с вложенными блоками", 3, 1, "группа", "toggle section"),
  tabs: entry("Вкладки", 3, 2, "tabs"),
  columns: entry("Колонки", 3, 3, "columns"),
  "three-columns": entry("Три колонки", 3, 4, "3 columns"),
  toc: entry("Оглавление", 3, 5, "toc"),
  divider: entry("Разделитель", 3, 6, "линия", "divider"),
  "label-divider": entry("Разделитель с подписью", 3, 7, "линия", "divider"),
  ...Object.fromEntries([1, 2, 3].map(level => [level === 1 ? "toggle_heading" : `toggle_heading_${level}`, entry(`Заголовок H${level} со сворачиванием`, 3, 8 + level, "сворачиваемый заголовок", `toggle heading${level}`)])),
  image: entry("Изображение", 4, 0, "картинка", "image"),
  video: entry("Видео", 4, 1, "video"),
  audio: entry("Аудио", 4, 2, "audio"),
  file: entry("Файл", 4, 3, "file"),
  "page-link": entry("Ссылка на страницу", 4, 4, "ссылка", "page link", "mention"),
  bookmark: entry("Закладка", 4, 5, "ссылка", "bookmark"),
  table: entry("Таблица", 5, 0, "таблица", "table"),
  code_block: entry("Блок кода", 5, 1, "код", "code"),
  emoji: entry("Emoji", 5, 2, "эмодзи", "emoji"),
};
export function organizeSlashCommands<T extends { key?: string; title: string; aliases?: readonly string[]; group?: string }>(items: T[]) {
  return items.map((item, index) => {
    const key = item.key ?? `command-${index}`;
    const metadata = SLASH_COMMANDS[key];
    const group = metadata?.group ?? 5;
    return { ...item, key, title: metadata?.title ?? item.title, aliases: [...new Set([item.title, ...(item.aliases ?? []), ...(metadata?.aliases ?? [])])], group: SLASH_GROUPS[group]!, size: "small" as const, rank: group * 100 + (metadata?.order ?? 20 + index) };
  }).sort((a, b) => a.rank - b.rank);
}
