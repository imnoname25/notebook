import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/studio.css", "utf8");
function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
function ratio(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
describe.each(["studio-graphite", "studio-atelier"])("%s semantic palette", (theme) => {
  const palette = css.match(new RegExp(`:root\\.${theme} \\{([^}]+)`))?.[1] ?? "";
  const tokens = Object.fromEntries([...palette.matchAll(/--studio-([\w-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [match[1], match[2]]));
  it.each([
    ["editor-text", "editor-bg"], ["editor-text", "paper"], ["editor-muted", "paper"],
    ["nav-text", "nav-bg"], ["nav-text", "list-bg"], ["nav-muted", "list-bg"],
    ["nav-selected-text", "nav-selected"], ["on-accent", "accent"], ["tag-text", "tag-bg"],
  ])("keeps %s on %s at WCAG AA", (foreground, background) => {
    expect(tokens[foreground]).toBeDefined();
    expect(tokens[background]).toBeDefined();
    expect(ratio(tokens[foreground]!, tokens[background]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps focus rings distinguishable from their surfaces", () => {
    expect(ratio(tokens.accent!, tokens.paper!)).toBeGreaterThanOrEqual(3);
    expect(ratio(tokens["nav-focus"]!, tokens["nav-bg"]!)).toBeGreaterThanOrEqual(3);
  });
  it("keeps subdued syntax comments readable on the code surface", () => {
    const blend = Number(css.match(/--studio-syntax-blend:\s*(\d+)%/)?.[1]) / 100;
    const comment = "#6a737d";
    const text = tokens["editor-text"]!;
    const mixed = "#" + [1, 3, 5].map((offset) => Math.round(parseInt(comment.slice(offset, offset + 2), 16) * (1 - blend) + parseInt(text.slice(offset, offset + 2), 16) * blend).toString(16).padStart(2, "0")).join("");
    expect(ratio(mixed, tokens["editor-muted-bg"]!)).toBeGreaterThanOrEqual(4.5);
  });
});
