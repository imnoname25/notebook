import { canonicalJson, cloneBlockWithIds } from "./document-state";
import { textFragment } from "./history-diff";
export type BlockRecovery = { historical: Record<string, unknown>; expected?: Record<string, unknown>; targetId?: string; mode: "replace" | "append" | "copy" | "fragment" };
export function allBlockIds(content: unknown[], exclude?: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();const visit = (list: unknown[]) => { for (const raw of list) { if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw === exclude) continue;const block = raw as Record<string, unknown>;if (typeof block.id === "string") ids.add(block.id);if (Array.isArray(block.children)) visit(block.children); } };visit(content);return ids;
}
export function prepareBlockRecovery(current: unknown[], request: BlockRecovery) {
  const matches: Record<string, unknown>[] = [];
  const find = (list: unknown[]) => { for (const raw of list) if (raw && typeof raw === "object" && !Array.isArray(raw)) { const block = raw as Record<string, unknown>;if (block.id === request.targetId) matches.push(block);if (Array.isArray(block.children)) find(block.children); } };find(current);
  const target = matches.length === 1 ? matches[0]! : null;
  if (request.mode === "replace" || request.mode === "fragment") {
    if (!target || !request.expected || canonicalJson(target) !== canonicalJson(request.expected)) throw new Error("Блок изменился после сравнения. Обновите сравнение перед восстановлением.");
    if (request.mode === "fragment") {
      const fragment = textFragment(request.historical, request.expected);
      if (!fragment) throw new Error("Этот фрагмент нельзя безопасно объединить. Восстановите блок целиком.");
      const content = structuredClone(target.content) as { type: string; text: string; styles?: unknown }[];
      content[0]!.text = fragment.prefix + fragment.removed + fragment.suffix;
      return { targetId: request.targetId!, block: { ...structuredClone(target), content } };
    }
    const used = allBlockIds(current, target);
    return { targetId: request.targetId!, block: cloneBlockWithIds(request.historical, used, request.targetId) };
  }
  const used = allBlockIds(current);
  if (request.mode === "append" && typeof request.historical.id === "string" && used.has(request.historical.id)) throw new Error("Блок уже существует. Обновите сравнение или вставьте копию.");
  if (request.mode === "copy") for (const id of allBlockIds([request.historical])) used.add(id);
  return { targetId: null, block: cloneBlockWithIds(request.historical, used) };
}
