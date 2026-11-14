import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { lockUserUploads } from "./upload-service";
import { classifySavedLink } from "@/lib/saved-link";
import { fetchSavedMetadata } from "@/lib/saved-metadata";
import { savedRequestFailure } from "@/lib/saved-metadata-network";
import { claimSavedItemMetadataJob, MAX_METADATA_ATTEMPTS, settleSavedItemMetadataJob } from "./saved-item-metadata-queue";

const IDLE_MS = 3_000;
const RETRY_BASE_MS = 60_000;
type Worker = { abort: AbortController; timer?: ReturnType<typeof setTimeout> };
const state = globalThis as typeof globalThis & { notebookSavedMetadataWorker?: Worker; notebookSavedMetadataSignals?: boolean };

export async function processSavedMetadataJob(signal: AbortSignal, fetchMetadata = fetchSavedMetadata) {
  if (signal.aborted) return false;
  const job = await claimSavedItemMetadataJob();
  if (!job || signal.aborted) return false;
  const link = classifySavedLink(job.url);
  const provider = link.kind === "article" ? "article" : link.provider;
  let metadata: Awaited<ReturnType<typeof fetchSavedMetadata>>;
  try {
    metadata = await fetchMetadata(job.url, signal);
  } catch (error) {
    if (signal.aborted) return false;
    const { reason, retryable, httpStatus } = savedRequestFailure(error);
    const shouldRetry = retryable && job.attempts < MAX_METADATA_ATTEMPTS;
    const settled = await db.$transaction(tx => settleSavedItemMetadataJob(tx, job, shouldRetry
      ? { status: "retry", retryAt: new Date(Date.now() + RETRY_BASE_MS * 2 ** (job.attempts - 1)) }
      : { status: "failed", reason }));
    if (settled) {
      console.warn(shouldRetry ? "Notebook saved metadata will retry" : "Notebook saved metadata unavailable",
        { provider, attempts: job.attempts, reason, httpStatus });
    } else {
      console.warn("Notebook saved metadata lost its lease", { provider, attempts: job.attempts, reason, httpStatus });
    }
    return true;
  }
  if (signal.aborted) return false;
  const stored = await db.$transaction(async tx => {
    const owner = await tx.savedItem.findUnique({ where: { id: job.savedItemId }, select: { userId: true } });
    if (!owner) return;
    await lockUserUploads(tx, owner.userId);
    const item = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT id FROM "SavedItem" WHERE id = ${job.savedItemId} AND url = ${job.url} FOR NO KEY UPDATE`);
    if (!item.length) return;
    if (!(await settleSavedItemMetadataJob(tx, job, { status: "done" }))) return;
    return tx.savedItem.update({ where: { id: job.savedItemId }, data: {
      metadataTitle: metadata.metadataTitle ?? undefined,
      metadataDescription: metadata.metadataDescription ?? undefined,
      metadataSiteName: metadata.metadataSiteName,
      metadataImageUrl: metadata.metadataImageUrl ?? undefined,
    }, select: { metadataImageUrl: true } });
  });
  if (stored && link.kind === "video" && link.provider === "youtube" && link.videoId) {
    console.info(stored.metadataImageUrl ? "Notebook saved oEmbed thumbnail stored" : "Notebook saved oEmbed has no usable thumbnail", { provider });
  }
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
