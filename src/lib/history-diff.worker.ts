import { compareBlocks } from "./history-diff";
self.onmessage = (event: MessageEvent<{ before: unknown[]; after: unknown[] }>) => {
  try { self.postMessage({ rows: compareBlocks(event.data.before, event.data.after) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Не удалось сравнить версии" }); }
};
