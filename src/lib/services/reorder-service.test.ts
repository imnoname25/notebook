import { describe, expect, it } from "vitest";
import { assertExactOrder } from "./reorder-service";

describe("reorder security contract", () => {
  it("accepts the complete set in a new order", () => expect(() => assertExactOrder(["c", "a", "b"], ["a", "b", "c"])).not.toThrow());
  it("rejects missing, duplicate and foreign ids", () => {
    expect(() => assertExactOrder(["a", "b"], ["a", "b", "c"])).toThrow();
    expect(() => assertExactOrder(["a", "a", "c"], ["a", "b", "c"])).toThrow();
    expect(() => assertExactOrder(["a", "b", "foreign"], ["a", "b", "c"])).toThrow();
  });
});
