import { expect, it } from "vitest";
import { tsvToTableHtml } from "./table-paste";

it("pastes a rectangular TSV grid using safe native HTML and destination widths", () => {
  const html = tsvToTableHtml("A\tB\r\nC\tD\r\n", [180, 220]);
  expect(html).toContain('<col style="width:180px">');
  expect(html).toContain('<tr><td colwidth="180">A</td><td colwidth="220">B</td></tr>');
  expect(html).toContain('<td colwidth="180">C</td>');
});
it("supports quoted tabs/newlines and escaped spreadsheet quotes", () => {
  expect(tsvToTableHtml('"A\tB"\t"line 1\nline 2"\n"Say ""hello"""\tD')).toContain("<td>A\tB</td><td>line 1<br>line 2</td>");
  expect(tsvToTableHtml('"Say ""hello"""\tD')).toContain("Say &quot;hello&quot;");
});
it("never interpolates clipboard HTML or arbitrary column CSS", () => {
  const html = tsvToTableHtml('<img src=x onerror=alert(1)>\tB', ['1px; color:red']);
  expect(html).not.toContain("<img");
  expect(html).not.toContain("color:red");
  expect(html).toContain("&lt;img");
});
it("leaves ordinary, malformed or excessive input to the native text path", () => {
  expect(tsvToTableHtml("normal text")).toBeNull();
  expect(tsvToTableHtml('"unclosed\tcell')).toBeNull();
  expect(tsvToTableHtml("a\t".repeat(10_001))).toBeNull();
});
