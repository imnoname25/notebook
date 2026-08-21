import { describe, expect, it } from "vitest";
import { getPageHref, pageIdFromPath } from "./workspace-navigation";

describe("workspace navigation", () => {
  it("creates one canonical page and block URL", () => {
    expect(getPageHref("page_1")).toBe("/pages/page_1");
    expect(getPageHref("page 1", "block/2")).toBe("/pages/page%201#block=block%2F2");
  });
  it("parses only canonical page paths", () => {
    expect(pageIdFromPath("/pages/page%201")).toBe("page 1");
    expect(pageIdFromPath("/api/pages/page_1")).toBeNull();
  });
});
