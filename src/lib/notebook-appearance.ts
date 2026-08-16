import {
  Archive, BookOpen, Briefcase, Code, Coffee, Folder, Gamepad2, Globe2,
  Heart, Home, Lightbulb, Notebook, Server, Star, Wrench,
  type LucideIcon,
} from "lucide-react";

export const NOTEBOOK_COLORS = ["default", "slate", "blue", "cyan", "green", "lime", "yellow", "orange", "red", "pink", "violet", "indigo", "brown"] as const;
export const NOTEBOOK_ICONS = ["notebook", "book", "briefcase", "home", "server", "code", "wrench", "gamepad", "heart", "star", "folder", "archive", "globe", "coffee", "lightbulb"] as const;
export type NotebookColor = typeof NOTEBOOK_COLORS[number];
export type NotebookIconId = typeof NOTEBOOK_ICONS[number];

export const NOTEBOOK_COLOR_LABELS: Record<NotebookColor, string> = {
  default: "Без цвета",
  slate: "Серый", blue: "Синий", cyan: "Бирюзовый", green: "Зелёный", lime: "Лаймовый", yellow: "Жёлтый",
  orange: "Оранжевый", red: "Красный", pink: "Розовый", violet: "Фиолетовый", indigo: "Индиго", brown: "Коричневый",
};
export const NOTEBOOK_COLOR_CLASSES: Record<NotebookColor, string> = {
  default: "bg-slate-500",
  slate: "bg-slate-500", blue: "bg-blue-500", cyan: "bg-cyan-500", green: "bg-green-500", lime: "bg-lime-500", yellow: "bg-yellow-500",
  orange: "bg-orange-500", red: "bg-red-500", pink: "bg-pink-500", violet: "bg-violet-500", indigo: "bg-indigo-500", brown: "bg-amber-800",
};
export const NOTEBOOK_ICON_LABELS: Record<NotebookIconId, string> = {
  notebook: "Блокнот", book: "Книга", briefcase: "Работа", home: "Дом", server: "Сервер", code: "Код", wrench: "Инструменты",
  gamepad: "Игры", heart: "Сердце", star: "Звезда", folder: "Папка", archive: "Архив", globe: "Мир", coffee: "Кофе", lightbulb: "Идеи",
};
export const NOTEBOOK_ICON_COMPONENTS: Record<NotebookIconId, LucideIcon> = {
  notebook: Notebook, book: BookOpen, briefcase: Briefcase, home: Home, server: Server, code: Code, wrench: Wrench,
  gamepad: Gamepad2, heart: Heart, star: Star, folder: Folder, archive: Archive, globe: Globe2, coffee: Coffee, lightbulb: Lightbulb,
};

export function isNotebookColor(value: string): value is NotebookColor { return (NOTEBOOK_COLORS as readonly string[]).includes(value); }
export function isNotebookIcon(value: string): value is NotebookIconId { return (NOTEBOOK_ICONS as readonly string[]).includes(value); }
