import { describe, expect, it } from "vitest";
import { extractHashtags, hashtagQuery } from "./hashtags";

describe("hashtags", () => {
  it("extracts and normalizes Cyrillic, Latin, digits, dash and underscore", () => {
    expect(extractHashtags("#VPN #работа #1с #важно_сегодня #mail-server #vpn"))
      .toEqual([
        { name: "VPN", normalized: "vpn" },
        { name: "работа", normalized: "работа" },
        { name: "1с", normalized: "1с" },
        { name: "важно_сегодня", normalized: "важно_сегодня" },
        { name: "mail-server", normalized: "mail-server" },
      ]);
  });

  it("does not treat fragments inside words as tags", () => {
    expect(extractHashtags("mail#tag example.com/#route #ok")).toEqual([
      { name: "route", normalized: "route" },
      { name: "ok", normalized: "ok" },
    ]);
    expect(hashtagQuery("#Работа")).toBe("работа");
  });
});
