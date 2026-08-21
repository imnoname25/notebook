export const UNDO_WINDOW_MS = 8_000;

export type ReversibleAction = {
  message: string;
  expiresAt: number;
  undo: () => Promise<void>;
};

export function createReversibleAction(message: string, undo: () => Promise<void>, now = Date.now(), timeoutMs = UNDO_WINDOW_MS): ReversibleAction {
  return { message, undo, expiresAt: now + timeoutMs };
}

export async function executeUndo(action: ReversibleAction, now = Date.now()) {
  if (now > action.expiresAt) throw new Error("UNDO_EXPIRED");
  await action.undo();
}
