export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Ошибка запроса");
  return body;
}

export function jsonOptions(method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): RequestInit {
  return { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
}
