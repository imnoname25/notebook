import { afterEach, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

const { startBackupScheduler } = vi.hoisted(() => ({ startBackupScheduler: vi.fn() }));
const { startSavedMetadataWorker } = vi.hoisted(() => ({ startSavedMetadataWorker: vi.fn() }));
vi.mock("@/lib/backup-scheduler", () => ({ startBackupScheduler }));
vi.mock("@/lib/services/saved-item-metadata-worker", () => ({ startSavedMetadataWorker }));
afterEach(() => { vi.unstubAllEnvs();vi.clearAllMocks(); });

it("starts the existing scheduler in the Node runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  await register();
  expect(startBackupScheduler).toHaveBeenCalledOnce();
  expect(startSavedMetadataWorker).toHaveBeenCalledOnce();
});

it.each(["edge", undefined])("does not start a Node scheduler for runtime %s", async runtime => {
  vi.stubEnv("NEXT_RUNTIME", runtime);
  await register();
  expect(startBackupScheduler).not.toHaveBeenCalled();
  expect(startSavedMetadataWorker).not.toHaveBeenCalled();
});

it("does not start metadata processing during a production build", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  await register();
  expect(startSavedMetadataWorker).not.toHaveBeenCalled();
});
