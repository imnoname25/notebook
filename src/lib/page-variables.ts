import { z } from "zod";

export const PAGE_VARIABLE_NAME = /^[\p{L}_][\p{L}\p{N}_-]{0,63}$/u;
export const pageVariableSchema = z.object({ name: z.string().trim().regex(PAGE_VARIABLE_NAME), value: z.string().max(1000) }).strict();
export const pageVariablesSchema = z.array(pageVariableSchema).max(32).superRefine((items, context) => {
  const names = new Set<string>();
  items.forEach((item, index) => {
    const normalized = item.name.toLocaleLowerCase("ru");
    if (names.has(normalized)) context.addIssue({ code: "custom", path: [index, "name"], message: "Имя переменной повторяется" });
    names.add(normalized);
  });
});
export type PageVariable = z.infer<typeof pageVariableSchema>;

export function parsePageVariables(value: unknown): PageVariable[] {
  if (typeof value !== "string") return [];
  try { return pageVariablesSchema.parse(JSON.parse(value)); } catch { return []; }
}

export function extractPageVariables(content: unknown): PageVariable[] {
  if (!Array.isArray(content)) return [];
  const pending = [...content];
  while (pending.length) {
    const block = pending.shift();
    if (!block || typeof block !== "object") continue;
    const candidate = block as Record<string, unknown>;
    if (candidate.type === "pageVariables") {
      const props = candidate.props && typeof candidate.props === "object" ? candidate.props as Record<string, unknown> : {};
      return parsePageVariables(props.data);
    }
    if (Array.isArray(candidate.children)) pending.push(...candidate.children);
  }
  return [];
}

export function resolvePageVariables(template: string, variables: PageVariable[]) {
  const values = new Map(variables.map((item) => [item.name.toLocaleLowerCase("ru"), item.value]));
  const unknown = new Set<string>();
  const value = template.replace(/\{\{([\p{L}_][\p{L}\p{N}_-]{0,63})\}\}/gu, (_token, name: string) => {
    const replacement = values.get(name.toLocaleLowerCase("ru"));
    if (replacement === undefined) { unknown.add(name); return `{{${name}}}`; }
    return replacement;
  });
  return { value, unknown: [...unknown] };
}

