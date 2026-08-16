import { describe, expect, it } from "vitest";
import { DICTIONARIES, RU_MESSAGES } from "./messages";

describe("Russian localization", () => {
  it("contains a non-empty Russian value for every declared key", () => {
    for (const [key, value] of Object.entries(RU_MESSAGES)) {
      expect(key).not.toBe("");
      expect(value.trim()).not.toBe("");
    }
  });

  it("keeps every locale dictionary key-complete", () => {
    const expected = Object.keys(RU_MESSAGES).sort();
    for (const dictionary of Object.values(DICTIONARIES)) expect(Object.keys(dictionary).sort()).toEqual(expected);
  });

  it("does not regress to the known English BlockNote placeholder", () => {
    expect(Object.values(RU_MESSAGES)).not.toContain("Enter text or type '/' for commands");
    expect(RU_MESSAGES["editor.placeholder"]).toBe("Начните писать или введите / для команд");
  });
});
