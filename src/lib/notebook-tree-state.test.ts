import { describe, expect, it } from "vitest";
import { ensureExpandedNotebook, toggleExpandedNotebook } from "./notebook-tree-state";

describe("independent notebook expansion", () => {
  it("allows several notebooks to remain expanded", () => {
    const both = toggleExpandedNotebook(new Set(["work"]), "personal");
    expect([...both]).toEqual(["work", "personal"]);
  });

  it("collapsing one notebook leaves the others unchanged", () => {
    const remaining = toggleExpandedNotebook(new Set(["work", "personal"]), "work");
    expect([...remaining]).toEqual(["personal"]);
  });

  it("selecting a notebook does not collapse another notebook", () => {
    const selected = ensureExpandedNotebook(new Set(["work", "personal"]), "work");
    expect([...selected]).toEqual(["work", "personal"]);
  });
});
