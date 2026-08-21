import { describe, expect, it } from "vitest";
import { mobileBackActionLog, mobileViewLogLevel, resolveMobileBack } from "./mobile-navigation";

describe("mobile Back contract", () => {
  it("closes overlays before changing navigation level", () => {
    expect(resolveMobileBack({ hasOverlay: true, screen: "workspace", view: "editor" })).toBe("close-overlay");
  });

  it("navigates editor to pages and pages to notebooks", () => {
    expect(resolveMobileBack({ hasOverlay: false, screen: "workspace", view: "editor" })).toBe("pages");
    expect(resolveMobileBack({ hasOverlay: false, screen: "workspace", view: "pages" })).toBe("navigation");
  });

  it("delegates root Back to Android instead of browser history", () => {
    expect(resolveMobileBack({ hasOverlay: false, screen: "workspace", view: "navigation" })).toBe("system");
  });

  it("returns from trash to the workspace first", () => {
    expect(resolveMobileBack({ hasOverlay: false, screen: "trash", view: "navigation" })).toBe("workspace");
    expect(resolveMobileBack({ hasOverlay: false, screen: "inbox", view: "navigation" })).toBe("workspace");
    expect(resolveMobileBack({ hasOverlay: false, screen: "today", view: "navigation" })).toBe("workspace");
  });

  it("exposes safe diagnostic labels for the native protocol", () => {
    expect(mobileViewLogLevel("editor")).toBe("PAGE_EDITOR");
    expect(mobileViewLogLevel("pages")).toBe("PAGE_LIST");
    expect(mobileViewLogLevel("navigation")).toBe("ROOT_NOTEBOOKS");
    expect(mobileBackActionLog("pages")).toBe("OPEN_PAGE_LIST");
  });
});
