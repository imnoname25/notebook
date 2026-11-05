import { afterEach, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

const { startBackupScheduler } = vi.hoisted(() => ({ startBackupScheduler: vi.fn() }));
vi.mock("@/lib/backup-scheduler", () => ({ startBackupScheduler }));
afterEach(() => { vi.unstubAllEnvs();vi.clearAllMocks(); });

it("starts the existing scheduler in the Node runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  await register();
  expect(startBackupScheduler).toHaveBeenCalledOnce();
});

it.each(["edge", undefined])("does not start a Node scheduler for runtime %s", async runtime => {
  vi.stubEnv("NEXT_RUNTIME", runtime);
  await register();
  expect(startBackupScheduler).not.toHaveBeenCalled();
});
