import { describe, expect, it, vi } from "vitest";
import { commandQuery, filterCommands } from "./command-palette";

describe("command palette", () => {
  const commands = [
    { id: "theme", title: "Переключить тему", aliases: ["dark", "light", "тема"], run: vi.fn() },
    { id: "inbox", title: "Открыть Стикеры", aliases: ["inbox", "входящие", "стикеры"], run: vi.fn() },
  ];
  it("enters command mode only after >", () => { expect(commandQuery("> dark")).toBe("dark"); expect(commandQuery("dark")).toBeNull(); });
  it("matches localized titles and aliases", () => { expect(filterCommands(commands, "dark")[0]?.id).toBe("theme"); expect(filterCommands(commands, "вход")[0]?.id).toBe("inbox"); });
});
