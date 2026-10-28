export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  let body: unknown;
  try { body = await response.json(); }
  catch (cause) {
    // Cancellation can happen after headers arrive, while the body is still streaming.
    // Returning {} here previously turned an aborted list request into successful undefined data.
    if (options?.signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) throw cause;
    if (response.ok) throw new Error("Сервер вернул некорректный JSON; состояние не обновлено");
    body = {};
  }
  if (options?.signal?.aborted) throw options.signal.reason ?? new DOMException("Запрос отменён", "AbortError");
  if (!response.ok) throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Ошибка запроса");
  return body as T;
}

export function jsonOptions(method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): RequestInit {
  return { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
}
