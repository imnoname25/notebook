import { describe, expect, it } from "vitest";
import { isSimplePrefixSearch } from "./search-query";
describe("safe FTS prefix completion", () => {
  it.each(["резерв", "Кварц8291", "postgr", "docker резерв", "7310"])("completes plain words: %s", query => expect(isSimplePrefixSearch(query)).toBe(true));
  it.each(["", "a", '"docker backup"', "docker OR backup", "docker -backup", "a:* | !b", "#tag", "Dockerfile.yml"])("preserves websearch syntax: %s", query => expect(isSimplePrefixSearch(query)).toBe(false));
});
