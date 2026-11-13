import { fetchSavedArticle } from "@/lib/saved-article-extraction";
import { classifySavedLink } from "@/lib/saved-link";
import { savedRequestFailure, SavedMetadataError } from "@/lib/saved-metadata-network";
import { downloadSavedArticleImages } from "./saved-article-images";
import {
  claimSavedArticleJob, MAX_ARTICLE_ATTEMPTS, settleSavedArticleJob, type SavedArticleOutcome,
} from "./saved-article-queue";

const IDLE_MS = 3_000;
const RETRY_BASE_MS = 60_000;

type Worker = { abort: AbortController; timer?: ReturnType<typeof setTimeout> };
const state = globalThis as typeof globalThis & { notebookSavedArticleWorker?: Worker; notebookSavedArticleSignals?: boolean };

export function savedArticleRequestFailure(error: unknown, attempts: number): SavedArticleOutcome {
  const { reason, retryable } = savedRequestFailure(error);
  if (!retryable && error instanceof SavedMetadataError) {
    return { status: "fallback", reason: reason === "size" ? "limits" : reason };
  }
  if (retryable && attempts < MAX_ARTICLE_ATTEMPTS) {
    return { status: "retry", reason, retryAt: new Date(Date.now() + RETRY_BASE_MS * 2 ** (attempts - 1)) };
  }
  return { status: "failed", reason };
}

export async function processSavedArticleJob(signal: AbortSignal, extract = fetchSavedArticle, download = downloadSavedArticleImages) {
  if (signal.aborted) return false;
  const job = await claimSavedArticleJob();
  if (!job || signal.aborted) return false;
  if (classifySavedLink(job.sourceUrl).kind !== "article") {
    await settleSavedArticleJob(job, { status: "fallback", reason: "link-type" }, signal);
    return true;
  }
  let outcome: SavedArticleOutcome;
  try {
    const result = await extract(job.sourceUrl, signal);
    outcome = result.status === "ready" && result.imageCandidates?.length
      ? { status: "ready", blocks: result.blocks, images: await download(result.imageCandidates, signal) }
      : result;
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
