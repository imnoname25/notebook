import { Schema } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { expect, it } from "vitest";
import { selectedLinkAddress } from "./editor-link-copy";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
  marks: { link: { attrs: { href: {} } }, bold: {} },
});
const href = "https://example.test/a?q=1#fragment";
const link = schema.mark("link", { href });
const bold = schema.mark("bold");
const other = schema.mark("link", { href: "https://other.test" });
const doc = schema.node("doc", null, [
  schema.node("paragraph", null, [
    schema.text("A"),
    schema.text("Li", [link]),
    schema.text("nk", [link, bold]),
    schema.text("B"),
    schema.text("Other", [other]),
  ]),
  schema.node("paragraph", null, schema.text("Second", [link])),
]);

it("copies the full link address even when the label uses multiple styles", () => {
  expect(selectedLinkAddress(TextSelection.create(doc, 2, 6))).toBe(href);
  expect(selectedLinkAddress(TextSelection.create(doc, 6, 2))).toBe(href);
});

it.each([[1, 2], [2, 2], [3, 6], [2, 5], [1, 6], [2, 12], [2, 15]])(
  "leaves the default clipboard formats for selection %s–%s",
  (from, to) => {
    expect(selectedLinkAddress(TextSelection.create(doc, from, to))).toBeUndefined();
  },
);
