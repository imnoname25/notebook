import { fetchSavedArticle } from "@/lib/saved-article-extraction";
import { SavedMetadataError } from "@/lib/saved-metadata-network";
import {
  claimSavedArticleJob, MAX_ARTICLE_ATTEMPTS, settleSavedArticleJob, type SavedArticleOutcome,
} from "./saved-article-queue";

const IDLE_MS = 3_000;
const RETRY_BASE_MS = 60_000;

type Worker = { abort: AbortController; timer?: ReturnType<typeof setTimeout> };
const state = globalThis as typeof globalThis & { notebookSavedArticleWorker?: Worker; notebookSavedArticleSignals?: boolean };

export function savedArticleRequestFailure(error: unknown, attempts: number): SavedArticleOutcome {
  let reason = "request";
  let retryable = false;
  if (error instanceof SavedMetadataError) {
    if (!error.retryable || [501, 505, 511].includes(error.httpStatus ?? 0)) {
      const reason = error.reason === "challenge" || [401, 403, 511].includes(error.httpStatus ?? 0) ? "access"
        : error.reason === "size" ? "limits" : error.reason;
      return { status: "fallback", reason };
    }
    reason = error.reason;
    retryable = true;
  } else if (error instanceof Error && error.name === "TimeoutError") {
    reason = "timeout";
    retryable = true;
  } else if (error instanceof Error && "code" in error && typeof error.code === "string") {
    retryable = ["EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ERR_STREAM_PREMATURE_CLOSE"].includes(error.code);
  }
  if (retryable && attempts < MAX_ARTICLE_ATTEMPTS) {
    return { status: "retry", reason, retryAt: new Date(Date.now() + RETRY_BASE_MS * 2 ** (attempts - 1)) };
  }
  return { status: "failed", reason };
}

export async function processSavedArticleJob(signal: AbortSignal, extract = fetchSavedArticle) {
  if (signal.aborted) return false;
  const job = await claimSavedArticleJob();
  if (!job || signal.aborted) return false;
  let outcome: SavedArticleOutcome;
  try {
    outcome = await extract(job.sourceUrl, signal);
  } catch (error) {
    outcome = savedArticleRequestFailure(error, job.attempts);
  }
  if (signal.aborted) return false;
  await settleSavedArticleJob(job, outcome, signal);
  return true;
}

export function stopSavedArticleWorker() {
  const worker = state.notebookSavedArticleWorker;
  if (!worker) return;
  clearTimeout(worker.timer);
  worker.abort.abort();
  state.notebookSavedArticleWorker = undefined;
}

export function startSavedArticleWorker() {
  if (state.notebookSavedArticleWorker) return;
  const worker: Worker = { abort: new AbortController() };
  state.notebookSavedArticleWorker = worker;
  function schedule(delay: number) {
    worker.timer = setTimeout(() => void tick(), delay);
    worker.timer.unref();
  }
  async function tick() {
    let processed = false;
    try {
      processed = await processSavedArticleJob(worker.abort.signal);
    } catch {
      if (!worker.abort.signal.aborted) console.error("Notebook saved article worker tick failed");
    } finally {
      if (!worker.abort.signal.aborted) schedule(processed ? 150 : IDLE_MS);
    }
  }
  if (!state.notebookSavedArticleSignals) {
    state.notebookSavedArticleSignals = true;
    process.once("SIGTERM", stopSavedArticleWorker);
    process.once("SIGINT", stopSavedArticleWorker);
  }
  schedule(IDLE_MS);
}
