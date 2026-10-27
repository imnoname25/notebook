import { describe, expect, it } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { history, undoDepth } from "prosemirror-history";
import { documentMatches, textMatches } from "@/lib/document-search";
import { createDocumentSearchPlugin, documentSearchKey } from "./document-search-extension";

const schema = new Schema({ nodes: { doc: { content: "block+" }, paragraph: { group: "block", content: "inline*" }, callout: { group: "block", content: "inline*" }, table: { group: "block", content: "row+" }, row: { content: "cell+" }, cell: { content: "paragraph+" }, text: { group: "inline" }, hard_break: { inline: true, group: "inline", atom: true } }, marks: { strong: {} } });
const paragraph = (text: string) => schema.node("paragraph", null, schema.text(text));
describe("document search view state", () => {
  it("locates Russian prefixes across formatting and preserves PM positions", () => {
    const doc = schema.node("doc", null, schema.node("paragraph", null, [schema.text("Ввод "), schema.text("Кварц", [schema.mark("strong")]), schema.text("8291 конец")]));
    const found = documentMatches(doc, "кварц8291").matches;
    expect(found).toEqual([{ from: 6, to: 15 }]);expect(doc.textBetween(found[0]!.from, found[0]!.to)).toBe("Кварц8291");
  });
  it("finds multiple matches in tables and callouts", () => {
    const doc = schema.node("doc", null, [paragraph("пример"), schema.node("callout", null, schema.text("пример")), schema.node("table", null, schema.node("row", null, schema.node("cell", null, paragraph("пример"))))]);
    const found = documentMatches(doc, "пример").matches;expect(found).toHaveLength(3);
    for (const match of found) expect(doc.textBetween(match.from, match.to)).toBe("пример");
  });
  it("keeps hard-break offsets and selects the server snippet's context", () => {
    const doc = schema.node("doc", null, [paragraph("Кварц в начале"), schema.node("paragraph", null, [schema.text("Конец"), schema.node("hard_break"), schema.text("Кварц возле уникального фрагмента")])]);
    const found = documentMatches(doc, "кварц", "Кварц возле уникального фрагмента");
    expect(found.preferred).toBe(1);expect(doc.textBetween(found.matches[1]!.from, found.matches[1]!.to)).toBe("Кварц");
  });
  it("does not interpret regex input or highlight negative search words", () => {
    expect(textMatches("foo bar", '"foo bar"')).toEqual([{ from: 0, to: 7 }]);
    expect(textMatches("foo bar", "foo -bar")).toEqual([{ from: 0, to: 3 }]);
    expect(textMatches("abc", ".*")).toEqual([]);
    expect(textMatches("ЗаголовокИскра7310", "Искра", false)).toEqual([{ from: 9, to: 14 }]);
  });
  it("changes decorations without a document transaction or undo entry", () => {
    let state = EditorState.create({ schema, doc: schema.node("doc", null, [paragraph("Кварц Кварц")]), plugins: [history(), createDocumentSearchPlugin()] });
    const original = state.doc.toJSON();
    const change = (value: { query?: string; active?: number }) => { const transaction = state.tr.setMeta(documentSearchKey, value).setMeta("addToHistory", false);expect(transaction.docChanged).toBe(false);state = state.apply(transaction); };
    change({ query: "кварц" });expect(documentSearchKey.getState(state)!.matches).toHaveLength(2);
    change({ active: 1 });expect(documentSearchKey.getState(state)!.active).toBe(1);
    expect(state.doc.toJSON()).toEqual(original);expect(undoDepth(state)).toBe(0);
    change({ query: "" });expect(documentSearchKey.getState(state)!.decorations.find()).toHaveLength(0);
  });
  it("updates safely when editing removes a match", () => {
    let state = EditorState.create({ schema, doc: schema.node("doc", null, paragraph("Кварц")), plugins: [createDocumentSearchPlugin()] });
    state = state.apply(state.tr.setMeta(documentSearchKey, { query: "кварц" }));
    state = state.apply(state.tr.delete(1, 6));
    expect(documentSearchKey.getState(state)!.matches).toEqual([]);expect(documentSearchKey.getState(state)!.active).toBe(-1);
  });
});
