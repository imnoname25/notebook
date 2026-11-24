import { describe, expect, it } from "vitest";
import { automaticLink, isEditorLink } from "./editor-links";

describe("automatic link recognition", () => {
  it.each(["settings.zip", "login.example.com", "user=one@example.org", "/home/example.com", "C:\\log\\example.com",
    "https://user:example@example.org/path", 'https://example.org/path"', "https://", "x-user:example", "fake@example"])(
    "treats %s as ordinary text", value => expect(automaticLink(value)).toBeUndefined(),
  );
  it.each([
    ["https://example.test/path", "https://example.test/path", "https://example.test/path"],
    ["http://example.test:3000.", "http://example.test:3000", "http://example.test:3000"],
    ["First.Last+fixture@example.test", "First.Last+fixture@example.test", "mailto:First.Last+fixture@example.test"],
  ])("recognizes %s without rewriting its label", (value, text, href) => {
    expect(automaticLink(value)).toEqual({ text, href });
  });
  it("keeps safe legacy hrefs while filtering executable schemes", () => {
    expect(isEditorLink("/pages/synthetic")).toBe(true);
    expect(isEditorLink("ftp://example.test")).toBe(true);
    expect(isEditorLink("java\nscript:alert(1)")).toBe(false);
    expect(isEditorLink("javascript:alert(1)")).toBe(false);
  });
});
