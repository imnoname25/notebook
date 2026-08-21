import { describe, expect, it } from "vitest";
import { extractPageVariables, pageVariablesSchema, resolvePageVariables } from "./page-variables";

describe("page variables", () => {
  it("validates Unicode names and rejects case-insensitive duplicates", () => {
    expect(pageVariablesSchema.parse([{ name: "хост", value: "server.local" }, { name: "port-1", value: "443" }])).toHaveLength(2);
    expect(() => pageVariablesSchema.parse([{ name: "HOST", value: "a" }, { name: "host", value: "b" }])).toThrow();
    expect(() => pageVariablesSchema.parse([{ name: "bad name", value: "x" }])).toThrow();
  });

  it("resolves known values and keeps unknown tokens visible", () => {
    const result = resolvePageVariables("https://{{host}}:{{port}}/{{unknown}}", [
      { name: "HOST", value: "example.test" },
      { name: "port", value: "8443" },
    ]);
    expect(result.value).toBe("https://example.test:8443/{{unknown}}");
    expect(result.unknown).toEqual(["unknown"]);
  });

  it("extracts the canonical hidden variables block from nested content", () => {
    expect(extractPageVariables([{ type: "tabs", children: [{ type: "tabPanel", children: [
      { type: "pageVariables", props: { data: JSON.stringify([{ name: "host", value: "nas.local" }]) } },
    ] }] }])).toEqual([{ name: "host", value: "nas.local" }]);
  });
});

