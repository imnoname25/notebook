import { afterEach, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

const { startBackupScheduler } = vi.hoisted(() => ({ startBackupScheduler: vi.fn() }));
const { startSavedMetadataWorker } = vi.hoisted(() => ({ startSavedMetadataWorker: vi.fn() }));
const { startSavedArticleWorker } = vi.hoisted(() => ({ startSavedArticleWorker: vi.fn() }));
vi.mock("@/lib/services/saved-article-worker", () => ({ startSavedArticleWorker }));
vi.mock("@/lib/backup-scheduler", () => ({ startBackupScheduler }));
vi.mock("@/lib/services/saved-item-metadata-worker", () => ({ startSavedMetadataWorker }));
afterEach(() => { vi.unstubAllEnvs();vi.clearAllMocks(); });

it("starts the existing scheduler in the Node runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("SAVED_ARTICLE_AUTO_EXTRACT", undefined);
  await register();
  expect(startSavedArticleWorker).not.toHaveBeenCalled();
  expect(startBackupScheduler).toHaveBeenCalledOnce();
  expect(startSavedMetadataWorker).toHaveBeenCalledOnce();
});

it.each(["edge", undefined])("does not start a Node scheduler for runtime %s", async runtime => {
  vi.stubEnv("NEXT_RUNTIME", runtime);
  await register();
  expect(startBackupScheduler).not.toHaveBeenCalled();
  expect(startSavedMetadataWorker).not.toHaveBeenCalled();
  expect(startSavedArticleWorker).not.toHaveBeenCalled();
});

it("does not start metadata processing during a production build", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  vi.stubEnv("SAVED_ARTICLE_AUTO_EXTRACT", "1");
  await register();
  expect(startSavedMetadataWorker).not.toHaveBeenCalled();
  expect(startSavedArticleWorker).not.toHaveBeenCalled();
});

it("starts article processing only with its independent flag", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("SAVED_ARTICLE_AUTO_EXTRACT", "1");
  vi.stubEnv("SAVED_ITEM_TITLE_ORIGINS", "0");
  await register();
  expect(startSavedArticleWorker).toHaveBeenCalledOnce();
});
