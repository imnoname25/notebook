import { describe, expect, it } from "vitest";
import { descendantSectionIds } from "./trash-service";

describe("trash subtree grouping", () => {
  it("collects only the selected section subtree", () => {
    const sections = [{ id: "root", parentId: null }, { id: "child", parentId: "root" }, { id: "grandchild", parentId: "child" }, { id: "sibling", parentId: null }];
    expect(descendantSectionIds(sections, "root").sort()).toEqual(["child", "grandchild", "root"]);
  });
});
