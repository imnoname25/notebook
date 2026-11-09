import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { appearancePatchSchema, DEFAULT_APPEARANCE, normalizeAppearance, THEME_FONTS } from "./appearance-preferences";
import { THEMES, nextTheme, STUDIO_THEMES } from "./themes";

describe("Studio appearance preferences", () => {
  it("retains only supplied PATCH fields", () => {
    expect(appearancePatchSchema.parse({ uiFont: "inter" })).toEqual({ uiFont: "inter" });
    expect(appearancePatchSchema.parse({})).toEqual({});
  });
  it("falls back per unknown field and retains valid overrides", () => {
    expect(normalizeAppearance({ theme: "removed", uiFont: "inter", editorFont: "removed", editorSize: 22, lineHeight: "relaxed" }))
      .toEqual({ theme: "system", uiFont: "inter", editorFont: "theme", editorSize: 22, lineHeight: "relaxed" });
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });
  it.each([{ editorSize: 11 }, { editorSize: 29 }, { editorSize: 15.5 }, { uiFont: "url(https://example.test)" }, { theme: "removed" }, { lineHeight: "500" }])("rejects invalid presentation input %#", value => {
    expect(() => appearancePatchSchema.parse(value)).toThrow();
  });
  it("provides six Studio themes and preserves legacy identifiers", () => {
    expect(STUDIO_THEMES).toHaveLength(6);
    expect(THEMES).toEqual(expect.arrayContaining(["system", "light", "dark", "atmospheric"]));
    let theme: string = "system";
    for (let index = 0; index < THEMES.length; index++) theme = nextTheme(theme);
    expect(theme).toBe("system");
  });
  it("uses the specified independent theme font defaults", () => {
    expect(THEME_FONTS["paper-coffee"]).toEqual({ ui: "source-sans-3", editor: "literata" });
    expect(THEME_FONTS["midnight-ink"]?.ui).toBe("ibm-plex-sans");
    expect(THEME_FONTS["forest-terminal"]?.ui).toBe("geist");
    expect(THEME_FONTS["nord-studio"]).toEqual({ ui: "manrope", editor: "inter" });
  });
});

describe("local font assets", () => {
  const manifest = JSON.parse(readFileSync("src/app/fonts/manifest.json", "utf8")) as Record<string, { cyrillic: boolean; sha256: string; sourceCommit: string }>;
  it.each(Object.keys(manifest))("ships licensed, audited Cyrillic WOFF2 for %s", family => {
    const data = readFileSync(`src/app/fonts/${family}.woff2`);
    expect(data.subarray(0, 4).toString()).toBe("wOF2");
    expect(createHash("sha256").update(data).digest("hex")).toBe(manifest[family]!.sha256);
    expect(manifest[family]!.cyrillic).toBe(true);
    expect(manifest[family]!.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
    const license = readFileSync(`src/app/fonts/${family}.OFL.txt`, "utf8");
    expect(license.toUpperCase()).toContain("SIL OPEN FONT LICENSE");
    expect(readFileSync("public/font-licenses.txt", "utf8").replace(/\r\n/g, "\n")).toContain(license.trim().replace(/\r\n/g, "\n"));
  });
  it("uses only local font loading", () => {
    const source = readFileSync("src/app/fonts.ts", "utf8");
    expect(source).toContain('from "next/font/local"');
    expect(source).not.toContain("next/font/google");
    expect(source).not.toContain("https://");
  });
});
