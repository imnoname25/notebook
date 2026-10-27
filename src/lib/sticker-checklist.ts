export type StickerLine = { start: number; end: number; raw: string; text: string; prefix: string; checked: boolean | null };

/** Body stays plain text. Never normalize unrelated lines or line endings. */
export function stickerLines(body: string): StickerLine[] {
  const lines: StickerLine[] = [];
  let start = 0;
  for (const chunk of body.split("\n")) {
    const raw = chunk.endsWith("\r") ? chunk.slice(0, -1) : chunk;
    const match = /^(\s*- \[([ xX])\] )(.*)$/u.exec(raw);
    lines.push({ start, end: start + raw.length, raw, text: match?.[3] ?? raw, prefix: match?.[1] ?? "", checked: match ? match[2]!.toLowerCase() === "x" : null });
    start += chunk.length + 1;
  }
  return lines;
}
export function checklistProgress(body: string) {
  const items = stickerLines(body).filter(line => line.checked !== null);
  return { done: items.filter(line => line.checked).length, total: items.length };
}
export function toggleStickerLine(body: string, index: number) {
  const line = stickerLines(body)[index];
  if (!line || line.checked === null) return body;
  const position = line.start + line.prefix.indexOf("[") + 1;
  return body.slice(0, position) + (line.checked ? " " : "x") + body.slice(position + 1);
}
export function replaceStickerLine(body: string, index: number, text: string) {
  const line = stickerLines(body)[index];
  return line ? body.slice(0, line.start) + line.prefix + text + body.slice(line.end) : body;
}
export function formatStickerLine(body: string, index: number) {
  const line = stickerLines(body)[index];
  return line ? body.slice(0, line.start) + (line.checked === null ? "- [ ] " + line.raw : line.text) + body.slice(line.end) : body;
}
export function stickerBlocks(body: string) {
  return stickerLines(body).map(line => ({
    type: line.checked === null ? "paragraph" : "checkListItem",
    ...(line.checked === null ? {} : { props: { checked: line.checked } }),
    content: line.text ? [{ type: "text", text: line.text, styles: {} }] : [],
  }));
}
