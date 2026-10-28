import { describe, expect, it, vi } from "vitest";
import { getDefaultReactSlashMenuItems } from "@blocknote/react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { notebookBlockNoteDictionary } from "@/lib/i18n/blocknote";
import { SLASH_GROUPS, organizeSlashCommands } from "@/lib/editor-slash-catalog";
import { CALLOUT_PRESETS } from "@/lib/editor-callouts";
import { notebookEditorSchema, slashMenuItems, type NotebookEditor } from "./editor-schema";
vi.mock("@blocknote/core", async original => ({ ...await original<typeof import("@blocknote/core")>(), insertOrUpdateBlockForSlashMenu: vi.fn() }));
const editor = { schema: notebookEditorSchema, dictionary: notebookBlockNoteDictionary } as unknown as NotebookEditor;
describe("Studio slash catalogue over installed BlockNote", () => {
  it("keeps every native callback and alias without replacing editor behavior", () => {
    const native = getDefaultReactSlashMenuItems(editor), organized = organizeSlashCommands(native);
    expect(native).toHaveLength(23);expect(organized).toHaveLength(native.length);
    for (const item of native) {
      const key = "key" in item ? String(item.key) : "";expect(key).not.toBe("");
      const copy = organized.find(candidate => candidate.key === key)!;
      expect(copy.onItemClick).toBe(item.onItemClick);expect(copy.aliases).toEqual(expect.arrayContaining(item.aliases ?? []));
      expect(copy.badge).toBe(item.badge);
    }
  });
  it("offers all 44 old actions plus two presets with unique keys/titles and contiguous groups", () => {
    const items = slashMenuItems(editor, vi.fn(), "");expect(items).toHaveLength(46);
    expect(new Set(items.map(item => item.key)).size).toBe(items.length);
    expect(new Set(items.map(item => item.title)).size).toBe(items.length);
    const segments = items.filter((item, index) => index === 0 || item.group !== items[index - 1]!.group).map(item => item.group);
    expect(segments).toEqual(SLASH_GROUPS);
    expect(items.filter(item => item.key.startsWith("widget-"))).toHaveLength(6);
  });
  it.each([["цит", "Цитата"], ["таб", "Таблица"], ["важ", "Важно"], ["идея", "Идея"], ["код", "Блок кода"], ["ссыл", "Ссылка на страницу"], ["quote", "Цитата"], ["code", "Блок кода"], ["information", "Информация"], ["выделенный блок", "Информация"], ["warning", "Предупреждение"], ["note", "Совет"]])("finds /%s locally", (query, title) => {
    expect(slashMenuItems(editor, vi.fn(), query).map(item => item.title)).toContain(title);
    expect(slashMenuItems(editor, vi.fn(), query).map(item => item.key)).toEqual(filterSuggestionItems(slashMenuItems(editor, vi.fn(), ""), query).map(item => item.key));
  });
  it("uses current callout kinds and existing insertion API for Important and Idea", () => {
    const items = slashMenuItems(editor, vi.fn(), "");
    for (const preset of CALLOUT_PRESETS) {
      items.find(item => item.key === `callout-${preset.key}`)!.onItemClick();
      expect(insertOrUpdateBlockForSlashMenu).toHaveBeenLastCalledWith(editor, { type: "callout", props: { kind: preset.kind, title: preset.title }, content: "" });
    }
    expect(notebookEditorSchema.blockSchema).not.toHaveProperty("important");expect(notebookEditorSchema.blockSchema).not.toHaveProperty("idea");
  });
});
