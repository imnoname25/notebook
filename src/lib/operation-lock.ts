import { ApiError } from "@/lib/errors";

const operationState = globalThis as typeof globalThis & { notebookDataOperation?: string };

export async function withDataOperation<T>(name: string, operation: () => Promise<T>) {
  if (operationState.notebookDataOperation) throw new ApiError(409, `Уже выполняется операция: ${operationState.notebookDataOperation}`);
  operationState.notebookDataOperation = name;
  try { return await operation(); }
  finally { operationState.notebookDataOperation = undefined; }
}
