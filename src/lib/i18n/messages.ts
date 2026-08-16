export const RU_MESSAGES = {
  "editor.placeholder": "Начните писать или введите / для команд",
  "editor.pageTitlePlaceholder": "Название страницы",
  "editor.untitled": "Без названия",
  "editor.saving": "Сохранение…",
  "editor.saved": "Сохранено",
  "editor.saveError": "Ошибка сохранения",
  "editor.copyCode": "Копировать код",
  "editor.copied": "Скопировано",
  "editor.group.text": "Текст",
  "editor.group.headings": "Заголовки",
  "editor.group.lists": "Списки",
  "editor.group.media": "Медиа",
  "editor.group.advanced": "Дополнительно",
  "editor.callout": "Выделенный блок",
  "editor.calloutDescription": "Информация, заметка или предупреждение",
  "editor.toggle": "Сворачиваемый блок",
  "editor.toggleDescription": "Раздел, который можно свернуть",
  "editor.pageLink": "Ссылка на страницу",
  "editor.pageLinkDescription": "Ссылка на другую страницу Notebook",
  "common.retry": "Повторить",
  "common.cancel": "Отмена",
  "common.save": "Сохранить",
  "common.close": "Закрыть",
  "common.loading": "Загрузка…",
  "search.empty": "Ничего не найдено",
  "history.empty": "Предыдущих версий пока нет",
  "trash.empty": "Корзина пуста",
  "settings.autosave": "Автосохранение, мс",
  "settings.snapshotInterval": "Снимок, минут",
  "settings.retentionDays": "Хранение, дней",
  "settings.username": "Имя пользователя",
  "settings.password": "Пароль",
  "settings.remoteDirectory": "Удалённый каталог",
  "settings.retry": "Повторить",
  "settings.localCopy": "Локальная копия",
} as const;

export type MessageKey = keyof typeof RU_MESSAGES;
export type Locale = "ru";
export const DEFAULT_LOCALE: Locale = "ru";
export const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { ru: RU_MESSAGES };

export function t(key: MessageKey, locale: Locale = DEFAULT_LOCALE): string {
  return DICTIONARIES[locale][key];
}
