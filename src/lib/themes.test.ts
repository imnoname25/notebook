import { describe, expect, it } from "vitest";
import { isDarkTheme, nextTheme, themeLabel } from "./themes";

describe("Notebook themes", () => {
  it("cycles through every supported theme and returns to system", () => {
    expect([nextTheme("system"), nextTheme("light"), nextTheme("dark"), nextTheme("atmospheric"), nextTheme("studio-graphite"), nextTheme("studio-atelier")])
      .toEqual(["light", "dark", "atmospheric", "studio-graphite", "studio-atelier", "system"]);
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
