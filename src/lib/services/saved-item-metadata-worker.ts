import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { fetchSavedMetadata } from "@/lib/saved-metadata";
import { SavedMetadataError } from "@/lib/saved-metadata-network";
import { claimSavedItemMetadataJob, MAX_METADATA_ATTEMPTS, settleSavedItemMetadataJob } from "./saved-item-metadata-queue";

const IDLE_MS = 3_000;
const RETRY_BASE_MS = 60_000;
type Worker = { abort: AbortController; timer?: ReturnType<typeof setTimeout> };
const state = globalThis as typeof globalThis & { notebookSavedMetadataWorker?: Worker; notebookSavedMetadataSignals?: boolean };

export async function processSavedMetadataJob(signal: AbortSignal, fetchMetadata = fetchSavedMetadata) {
  if (signal.aborted) return false;
  const job = await claimSavedItemMetadataJob();
  if (!job || signal.aborted) return false;
  let metadata: Awaited<ReturnType<typeof fetchSavedMetadata>>;
  try {
    metadata = await fetchMetadata(job.url, signal);
  } catch (error) {
    if (signal.aborted) return false;
    const retryable = error instanceof SavedMetadataError ? error.retryable : !(error instanceof TypeError);
    const shouldRetry = retryable && job.attempts < MAX_METADATA_ATTEMPTS;
    const settled = await db.$transaction(tx => settleSavedItemMetadataJob(tx, job, shouldRetry
      ? { status: "retry", retryAt: new Date(Date.now() + RETRY_BASE_MS * 2 ** (job.attempts - 1)) }
      : { status: "failed" }));
    if (settled && !shouldRetry) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "";
      const reason = error instanceof SavedMetadataError ? error.reason
        : error instanceof Error && error.name === "TimeoutError" ? "timeout"
        : ["ENOTFOUND", "EAI_AGAIN"].includes(code) ? "dns"
        : /^(?:ERR_TLS_|CERT_|UNABLE_TO_VERIFY_|SELF_SIGNED_|DEPTH_ZERO_SELF_SIGNED_CERT)/u.test(code) ? "tls"
        : "request";
      console.warn("Notebook saved metadata unavailable", {
        savedItemId: job.savedItemId, attempts: job.attempts, reason,
        httpStatus: error instanceof SavedMetadataError ? error.httpStatus : undefined,
      });
    }
    return true;
  }
  if (signal.aborted) return false;
  await db.$transaction(async tx => {
    const item = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "SavedItem" WHERE id = ${job.savedItemId} AND url = ${job.url} FOR NO KEY UPDATE`);
    if (!item.length) return;
    if (await settleSavedItemMetadataJob(tx, job, { status: "done" })) {
      await tx.savedItem.update({ where: { id: job.savedItemId }, data: metadata });
    }
  });
  return true;
}

export function stopSavedMetadataWorker() {
  const worker = state.notebookSavedMetadataWorker;
  if (!worker) return;
  clearTimeout(worker.timer);
  worker.abort.abort();
  state.notebookSavedMetadataWorker = undefined;
}

export function startSavedMetadataWorker() {
  if (state.notebookSavedMetadataWorker) return;
  const worker: Worker = { abort: new AbortController() };
  state.notebookSavedMetadataWorker = worker;
  const schedule = (delay: number) => {
    worker.timer = setTimeout(() => void tick(), delay);
    worker.timer.unref();
  };
  async function tick() {
    let processed = false;
    try {
      processed = await processSavedMetadataJob(worker.abort.signal);
    } catch {
      if (!worker.abort.signal.aborted) console.error("Notebook saved metadata worker tick failed");
    } finally {
      if (!worker.abort.signal.aborted) schedule(processed ? 150 : IDLE_MS);
    }
  }
  if (!state.notebookSavedMetadataSignals) {
    state.notebookSavedMetadataSignals = true;
    process.once("SIGTERM", stopSavedMetadataWorker);
    process.once("SIGINT", stopSavedMetadataWorker);
  }
  schedule(IDLE_MS);
}
