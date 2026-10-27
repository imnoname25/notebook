import { describe, expect, it } from "vitest";
import { checklistProgress, formatStickerLine, replaceStickerLine, stickerBlocks, stickerLines, toggleStickerLine } from "./sticker-checklist";

describe("plain text sticker checklists", () => {
  it("leaves ordinary notes and non-checklist punctuation alone", () => {
    const body = "Обычная заметка\n[ ] пример\n- [no] не чекбокс\n";
    expect(checklistProgress(body)).toEqual({ done: 0, total: 0 });
    expect(toggleStickerLine(body, 1)).toBe(body);
    expect(stickerLines(body).map(line => line.text).join("\n")).toBe(body);
  });
  it("counts multiple mixed lists and changes only the checkbox character", () => {
    const body = "Текст\r\n- [ ] Один\r\n- [X] Два\r\n\r\nДругой список\r\n  - [x] Три #дом";
    expect(checklistProgress(body)).toEqual({ done: 2, total: 3 });
    const checked = toggleStickerLine(body, 1);
    expect(checked).toBe(body.replace("- [ ] Один", "- [x] Один"));
    expect(toggleStickerLine(checked, 1)).toBe(body);
    expect(replaceStickerLine(body, 2, "Новое имя")).toContain("- [X] Новое имя\r\n");
  });
  it("formats an empty or existing plain line without changing surrounding text", () => {
    expect(formatStickerLine("", 0)).toBe("- [ ] ");
    expect(formatStickerLine("A\nB\nC", 1)).toBe("A\n- [ ] B\nC");
    expect(formatStickerLine("A\n- [x] B\nC", 1)).toBe("A\nB\nC");
  });
  it("converts explicitly to native BlockNote items and preserves paragraphs", () => {
    expect(stickerBlocks("Intro\n- [x] Done\n- [ ] Todo\n")).toMatchObject([
      { type: "paragraph", content: [{ text: "Intro" }] },
      { type: "checkListItem", props: { checked: true }, content: [{ text: "Done" }] },
      { type: "checkListItem", props: { checked: false }, content: [{ text: "Todo" }] },
      { type: "paragraph", content: [] },
    ]);
  });
});
