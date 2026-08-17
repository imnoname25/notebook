import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android and mobile shell contract", () => {
  it("configures native status bars and safe-area fallbacks", () => {
    const config = readFileSync("android-client/capacitor.config.ts", "utf8");
    const shell = readFileSync("android-client/www/app.js", "utf8");
    const styles = readFileSync("src/app/globals.css", "utf8");
    expect(config).toContain("overlaysWebView: false");
    expect(config).toContain('insetsHandling: "css"');
    expect(shell).toContain("StatusBar.setOverlaysWebView({ overlay: false })");
    expect(styles).toContain("var(--safe-area-inset-top, env(safe-area-inset-top, 0px))");
  });

  it("keeps secondary actions out of the mobile header", () => {
    const mobileHeader = readFileSync("src/components/notebook/mobile-app-header.tsx", "utf8");
    const header = mobileHeader.match(/<header data-testid="mobile-app-header"[\s\S]*?<\/header>/)?.[0];
    expect(header).toBeTruthy();
    expect(header).toContain("Открыть навигацию");
    expect(header).toContain('aria-label="Поиск"');
    expect(header).toContain('aria-label="Ещё"');
    expect(header).not.toContain("ShieldCheck");
    expect(header).not.toContain("Settings");
    expect(mobileHeader).toContain("Выйти на всех устройствах");
  });
});
