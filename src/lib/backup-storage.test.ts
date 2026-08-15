import { describe, expect, it } from "vitest";
import { backupFilename, resolveBackupPath } from "./backup-storage";
describe("backup path safety", () => { it("uses a predictable safe prefix", () => expect(backupFilename(new Date("2026-08-14T08:30:00Z"))).toBe("notebook-backup-2026-08-14T08-30-00-000Z.zip")); it.each(["../secret", "folder/file.zip", "C:\\secret.zip", "\0bad"])('rejects %s', (value) => expect(() => resolveBackupPath(value)).toThrow()); });

