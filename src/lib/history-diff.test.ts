import { describe, expect, it } from "vitest";
import { compareBlocks, textFragment } from "./history-diff";
import { prepareBlockRecovery, allBlockIds } from "./block-recovery";
const paragraph = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
describe("structural history diff and recovery", () => {
  it("compares a long document without treating one insertion as a movement of every block", () => {
    const old = Array.from({ length: 2_000 }, (_, index) => paragraph(`long-${index}`, `Раздел ${index} — ${"длинный текст ".repeat(8)}`));
    const next = [...old.slice(0, 500), paragraph("new", "Вставка"), ...old.slice(500)];
    const rows = compareBlocks(old, next);expect(rows.filter(row => row.change === "added")).toHaveLength(1);expect(rows.filter(row => row.change === "unchanged")).toHaveLength(2_000);
  });
  it("distinguishes insertion, deletion, format and table changes without shifting every row", () => {
    const old = [paragraph("a", "First"), paragraph("b", "Second"), { id: "table", type: "table", content: { rows: [{ cells: ["A"] }] } }];
    const next = [paragraph("new", "Added"), { ...old[0], content: [{ type: "text", text: "First", styles: { bold: true } }] }, { ...old[2], content: { rows: [{ cells: ["B"] }] } }];
    expect(compareBlocks(old, next).map(row => row.change)).toEqual(["added", "changed", "removed", "changed"]);
  });
  it("matches an exact recreated block but refuses ambiguous or merely similar text", () => {
    expect(compareBlocks([paragraph("a", "Same")], [paragraph("new", "Same")])[0]!.change).toBe("unchanged");
    expect(compareBlocks([paragraph("a", "Similar")], [paragraph("new", "Similarity")]).map(row => row.change).sort()).toEqual(["added", "removed"]);
    expect(compareBlocks([paragraph("a", "Duplicate"), paragraph("b", "Duplicate")], [paragraph("new", "Duplicate")]).filter(row => row.change === "unchanged")).toHaveLength(0);
  });
  it("recognizes reorder and nested parent movement", () => {
    const a = paragraph("a", "A"), b = paragraph("b", "B"), c = paragraph("c", "C");
    expect(compareBlocks([a, b, c], [b, a, c]).filter(row => row.moved)).toHaveLength(1);
    expect(compareBlocks([{ ...a, children: [c] }, b], [a, { ...b, children: [c] }]).find(row => row.oldPath?.length === 2)?.moved).toBe(true);
  });
  it("copies complete subtrees with fresh IDs, preserving page IDs and aliases", () => {
    const block = { ...paragraph("a", "A"), children: [{ ...paragraph("b", "B"), content: [{ type: "pageLink", props: { pageId: "target", text: "Alias", alias: true } }] }] };
    const copied = prepareBlockRecovery([block], { historical: block, mode: "copy" }).block;
    expect([...allBlockIds([copied])].some(id => ["a", "b"].includes(id))).toBe(false);expect(JSON.stringify(copied)).toContain('"pageId":"target"');
  });
  it("preserves target identity, avoids colliding descendants and rejects stale recovery", () => {
    const current = paragraph("a", "Now"), elsewhere = paragraph("child", "Elsewhere");const old = { ...paragraph("a", "Before"), children: [paragraph("child", "Old child")] };
    const result = prepareBlockRecovery([current, elsewhere], { historical: old, expected: current, targetId: "a", mode: "replace" });
    expect(result.block.id).toBe("a");expect((result.block.children as { id: string }[])[0]!.id).not.toBe("child");
    expect(() => prepareBlockRecovery([current], { historical: old, expected: paragraph("a", "Stale"), targetId: "a", mode: "replace" })).toThrow(/изменился/);
    const withDuplicateChild = { ...current, children: [paragraph("child", "Duplicate from an old import")] };
    const repaired = prepareBlockRecovery([withDuplicateChild, elsewhere], { historical: old, expected: withDuplicateChild, targetId: "a", mode: "replace" });
    expect((repaired.block.children as { id: string }[])[0]!.id).not.toBe("child");
  });
  it("restores Unicode fragments and keeps formatting, refusing incompatible inline structures", () => {
    const old = paragraph("a", "До 👩‍💻 старое ё после"), next = paragraph("a", "До 👩‍💻 новое ё после");
    expect(textFragment(old, next)).toMatchObject({ prefix: "До 👩‍💻 ", removed: "стар", added: "нов" });
    const result = prepareBlockRecovery([next], { historical: old, expected: next, targetId: "a", mode: "fragment" });expect(result.block.content).toEqual(old.content);
    expect(textFragment(old, { ...next, content: [{ type: "pageLink", props: { pageId: "a" } }] })).toBeNull();
  });
});
