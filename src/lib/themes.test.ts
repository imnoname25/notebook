import { describe, expect, it } from "vitest";
import { isDarkTheme, nextTheme, themeLabel, THEME_REGISTRY, THEMES, themeDefinition } from "./themes";

describe("Notebook themes", () => {
  it("cycles through every supported theme and returns to system", () => {
    expect([nextTheme("system"), nextTheme("light"), nextTheme("dark"), nextTheme("atmospheric"), nextTheme("studio-graphite"), nextTheme("studio-atelier")])
      .toEqual(["light", "dark", "atmospheric", "studio-graphite", "studio-atelier", "midnight-ink"]);
    expect(nextTheme(undefined)).toBe("system");
    expect(nextTheme("invalid")).toBe("system");
  });
  it("uses the dark editor palette for Atmospheric", () => {
    expect(isDarkTheme("atmospheric")).toBe(true);
    expect(isDarkTheme("dark")).toBe(true);
    expect(isDarkTheme("light")).toBe(false);
    expect(isDarkTheme(undefined)).toBe(false);
    expect(themeLabel("atmospheric")).toBe("Атмосферная");
  });
  it("keeps Atelier's editor light while Graphite uses the dark editor", () => {
    expect(isDarkTheme("studio-graphite")).toBe(true);
    expect(isDarkTheme("studio-atelier")).toBe(false);
    expect(themeLabel("studio-graphite")).toBe("Studio Graphite");
    expect(themeLabel("studio-atelier")).toBe("Studio Atelier");
  });
});


describe("approved visual identity registry", () => {
  it("retains every persisted identifier and centralizes labels and light/dark mode", () => {
    expect(Object.keys(THEME_REGISTRY)).toEqual([...THEMES]);
    expect(["midnight-ink", "paper-coffee", "forest-terminal", "nord-studio"].map(themeLabel)).toEqual(["Cyberdeck", "Writer", "Signal", "Creative"]);
    expect(isDarkTheme("forest-terminal")).toBe(false);
    expect(isDarkTheme("midnight-ink")).toBe(true);
    expect(themeDefinition("retired")).toBe(THEME_REGISTRY.system);
  });
  it("keeps independent display fonts within the installed font allowlist", () => {
    expect(THEME_REGISTRY["forest-terminal"].fonts).toEqual({ ui: "geist", editor: "source-sans-3", title: "manrope" });
    expect(THEME_REGISTRY["paper-coffee"].fonts?.title).toBe("literata");
  });
});
