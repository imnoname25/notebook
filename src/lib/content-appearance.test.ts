import { describe, expect, it } from "vitest";
import {
  isAccentColor,
  isPageIcon,
  pagePresetAppearance,
  resetPageAppearance,
  resolveAppearanceAccent,
} from "./content-appearance";
import {
  accountPreferencesSchema,
  pageUpdateSchema,
  sectionUpdateSchema,
} from "./validation";
import { settingsUpdateSchema } from "./application-settings";
import { pageExportSchema } from "./data-format";

describe("appearance validation", () => {
  it("accepts curated section and page appearance", () => {
    expect(sectionUpdateSchema.parse({ color: "violet" }).color).toBe("violet");
    expect(
      pageUpdateSchema.parse({
        icon: "💡",
        color: "blue",
        coverUploadId: "upload-1",
      }).icon,
    ).toBe("💡");
  });
  it("rejects CSS colors and text masquerading as emoji", () => {
    expect(isAccentColor("url(red)")).toBe(false);
    expect(isPageIcon("password")).toBe(false);
    expect(() => sectionUpdateSchema.parse({ color: "#fff" })).toThrow();
  });
  it("supports only comfortable and compact density", () => {
    expect(
      settingsUpdateSchema.parse({ interfaceDensity: "compact" })
        .interfaceDensity,
    ).toBe("compact");
    expect(() =>
      settingsUpdateSchema.parse({ interfaceDensity: "tiny" }),
    ).toThrow();
  });
  it("keeps page appearance in the portable contract", () => {
    const now = new Date().toISOString();
    const parsed = pageExportSchema.parse({
      manifest: {
        format: "notebook-page",
        version: 1,
        createdAt: now,
        app: "Notebook",
      },
      page: {
        key: "p",
        title: "Page",
        icon: "📝",
        color: "green",
        coverAttachmentKey: "cover",
        content: [{ type: "paragraph", content: [] }],
        sortOrder: 0,
        isFavorite: false,
        createdAt: now,
        updatedAt: now,
      },
      attachments: [
        {
          key: "cover",
          fileName: "cover.webp",
          mimeType: "image/webp",
          size: 1,
          sha256: null,
          dataBase64: "AA==",
        },
      ],
    });
    expect(parsed.page).toMatchObject({
      icon: "📝",
      color: "green",
      coverAttachmentKey: "cover",
    });
  });
  it("keeps presets typed and reset neutral", () => {
    expect(pagePresetAppearance("ocean")).toMatchObject({
      color: "blue",
      backgroundType: "gradient",
      backgroundGradient: "ocean",
    });
    expect(resetPageAppearance()).toEqual({
      color: "default",
      backgroundType: "default",
      backgroundColor: "default",
      backgroundGradient: null,
      backgroundPattern: "plain",
      backgroundUploadId: null,
      backgroundPosition: "center",
      backgroundOverlay: "medium",
      appearancePreset: null,
    });
  });
  it("gives every named preset a distinct, recognizable configuration", () => {
    const presets = ["minimal", "paper", "dark-grid", "warm-notes", "ocean", "focus"] as const;
    const signatures = presets.map((preset) => JSON.stringify(pagePresetAppearance(preset)));
    expect(new Set(signatures).size).toBe(presets.length);
    expect(pagePresetAppearance("dark-grid")).toMatchObject({ backgroundType: "pattern", backgroundPattern: "blueprint", color: "cyan" });
    expect(pagePresetAppearance("paper")).toMatchObject({ backgroundType: "pattern", backgroundPattern: "paper" });
  });
  it("validates every background selector server-side", () => {
    expect(
      pageUpdateSchema.parse({
        backgroundType: "image",
        backgroundColor: "teal",
        backgroundGradient: "aurora",
        backgroundPattern: "dot-grid",
        backgroundPosition: "bottom",
        backgroundOverlay: "strong",
        appearancePreset: "warm-notes",
      }),
    ).toMatchObject({ backgroundType: "image", backgroundOverlay: "strong" });
    expect(() =>
      pageUpdateSchema.parse({ backgroundPattern: "url(evil)" }),
    ).toThrow();
  });
  it("validates appearance preferences", () => {
    expect(
      accountPreferencesSchema.parse({
        sectionAccentIntensity: "expressive",
        pageListView: "preview",
        defaultPagePreset: "paper",
      }),
    ).toEqual({
      sectionAccentIntensity: "expressive",
      pageListView: "preview",
      defaultPagePreset: "paper",
    });
    expect(() =>
      accountPreferencesSchema.parse({ defaultPagePreset: "custom-css" }),
    ).toThrow();
  });
  it("inherits semantic accents from section and notebook", () => {
    expect(resolveAppearanceAccent("default", "teal", "red")).toBe("teal");
    expect(resolveAppearanceAccent(null, "default", "blue")).toBe("blue");
    expect(resolveAppearanceAccent("default", null, "brown")).toBe("amber");
  });
});
