export type PaletteCommand = { id: string; title: string; aliases: string[]; disabled?: boolean; run(): void };

export function commandQuery(value: string) {
  const trimmed = value.trimStart();
  return trimmed.startsWith(">") ? trimmed.slice(1).trim().toLocaleLowerCase("ru-RU") : null;
}

export function filterCommands(commands: PaletteCommand[], query: string) {
  const needle = query.toLocaleLowerCase("ru-RU");
  if (!needle) return commands;
  return commands
    .map((command, index) => {
      const title = command.title.toLocaleLowerCase("ru-RU");
      const exact = title === needle ? 4 : title.startsWith(needle) ? 3 : title.includes(needle) ? 2 : command.aliases.some((alias) => alias.toLocaleLowerCase("ru-RU").includes(needle)) ? 1 : 0;
      return { command, index, score: exact };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ command }) => command);
}
