import { describe, expect, it } from "vitest";
import { assertOwner } from "./ownership";

describe("ownership guard", () => {
  it("allows the resource owner", () => expect(() => assertOwner("user-1", "user-1")).not.toThrow());
  it("hides foreign and missing resources", () => {
    expect(() => assertOwner("user-2", "user-1")).toThrowError("Объект не найден");
    expect(() => assertOwner(undefined, "user-1")).toThrowError("Объект не найден");
  });
});
