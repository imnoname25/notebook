import { Schema, type Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { CellSelection, tableNodes } from "prosemirror-tables";
import { describe, expect, it } from "vitest";
import { selectionClipboardText } from "./editor-clipboard";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*" },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: { link: { attrs: { href: {} } }, bold: {} },
});

it("retains columns for text spanning rows and exports rectangle selections as TSV", () => {
  const tm = new Schema({ nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
    ...tableNodes({ tableGroup: "block", cellContent: "paragraph+", cellAttributes: {} }),
  } });
  const cell = (value: string) => tm.node("table_cell", null, tm.node("paragraph", null, tm.text(value)));
  const row = (...values: string[]) => tm.node("table_row", null, values.map(cell));
  const doc = tm.node("doc", null, tm.node("table", null, [row("A1", "B1"), row("A2", "B\t2")]));
  const cells: number[] = [];
  const positions = new Map<string, number>();
  doc.descendants((node, position) => {
    if (node.type.spec.tableRole === "cell") cells.push(position);
    if (node.text) positions.set(node.text, position);
  });
  const textRange = TextSelection.create(doc, positions.get("B1")!, positions.get("A2")! + 2);
  expect(selectionClipboardText(textRange)).toBe("\tB1\nA2\t");
  const rectangle = CellSelection.create(doc, cells[0], cells[3]);
  expect(selectionClipboardText(rectangle)).toBe('A1\tB1\nA2\t"B\t2"');
});
const paragraph = (...content: Node[]) =>
  schema.node("paragraph", null, content);

describe("clipboard text", () => {
  const label = "visible URL label";
  const legacy = schema.node("doc", null, paragraph(
    schema.text("First"), schema.node("hardBreak"),
    schema.text(label, [schema.mark("link", { href: "https://example.test/" })]),
    schema.node("hardBreak"), schema.text("Third"), schema.node("hardBreak"), schema.text("Fourth"),
  ));
  it("copies exactly the visible range in either direction inside a legacy paragraph", () => {
    expect(selectionClipboardText(TextSelection.create(legacy, 7, 7 + label.length))).toBe(label);
    expect(selectionClipboardText(TextSelection.create(legacy, 7 + label.length, 7))).toBe(label);
    expect(selectionClipboardText(TextSelection.create(legacy, 8, 14))).toBe("isible");
  });

  it("preserves paragraph breaks, empty paragraphs and consecutive hard breaks", () => {
    const doc = schema.node("doc", null, [
      paragraph(schema.text("A"), schema.node("hardBreak"), schema.node("hardBreak"), schema.text("B")),
      paragraph(),
      paragraph(schema.text("C")),
    ]);
    expect(selectionClipboardText(TextSelection.create(doc, 1, doc.content.size - 1))).toBe("A\n\nB\n\nC");
  });

  it.each([
    "  [fixture]_*#()&!\\\t  \uFFFC",
    "C:\\Project\\Note\\file.txt",
    "/var/lib/example/data",
    '$env:NAME = "example"',
    'printf "%s\\n" "$value"',
    '{"fixture": ["α", "🧪"]}',
  ])("preserves literal technical text %s", text => {
    const doc = schema.node("doc", null, paragraph(schema.text(text, [schema.mark("bold")])));
    expect(selectionClipboardText(TextSelection.create(doc, 1, text.length + 1))).toBe(text);
  });

  it("copies an email label without its mailto scheme", () => {
    const text = "fixture@example.test";
    const doc = schema.node("doc", null, paragraph(schema.text(text, [schema.mark("link", { href: `mailto:${text}` })])));
    expect(selectionClipboardText(TextSelection.create(doc, 1, text.length + 1))).toBe(text);
  });
});
