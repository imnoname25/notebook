import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { backupFilename, resolveBackupPath } from "./backup-storage";
describe("backup path safety", () => {
  let fixture: string;
  let root: string;

  beforeAll(async () => {
    fixture = await mkdtemp(path.join(tmpdir(), "notebook-backup-storage-"));
    root = path.join(fixture, "backups");
    await mkdir(root);
  });
  beforeEach(() => vi.stubEnv("BACKUP_DIR", root));
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    // Delete only the direct temporary child created by this suite, never BACKUP_DIR from env.
    const relative = path.relative(path.resolve(tmpdir()), fixture);
    expect(path.isAbsolute(relative)).toBe(false);
    expect(relative.split(path.sep)).toHaveLength(1);
    expect(relative).toMatch(/^notebook-backup-storage-/);
    await rm(fixture, { recursive: true, force: true });
  });

  it("uses a predictable safe prefix", () => {
    expect(backupFilename(new Date("2026-08-14T08:30:00Z")))
      .toBe("notebook-backup-2026-08-14T08-30-00-000Z.zip");
  });

  it.each([
    "", ".", "..", "../secret", "..\\secret.zip", "folder/file.zip", "folder\\file.zip",
    "folder/../backup.zip", "folder\\..\\backup.zip", "folder/..\\backup.zip",
    "/secret.zip", "//server/share/secret.zip", "\\secret.zip", "C:\\secret.zip", "C:/secret.zip",
    "C:secret.zip", "C:", "\\\\server\\share\\secret.zip", "\\\\?\\C:\\secret.zip", "\\\\.\\C:\\secret.zip",
    "file:///etc/secret.zip", "file:secret.zip", "https://example.com/secret.zip", "https:secret.zip",
    "%2e%2e%2fsecret.zip", "..%5csecret.zip", "%252e%252e%252fsecret.zip",
    "backup.zip:secret", "backup.zip::$DATA", "\0bad", "bad\nname.zip", "backup.zip ", "backup.zip.",
    "NUL", "nul.zip", "CON.zip", "COM1.zip", "LPT9.zip", "COM¹.zip", "CONIN$.zip", "bad?.zip", "bad*.zip",
  ])("rejects %j on every host OS", (value) => {
    expect(() => resolveBackupPath(value)).toThrow();
  });

  it.each(["backup.zip", ".backup.zip", "backup..zip", "резервная-копия.zip", backupFilename()])("accepts a portable basename %j", (name) => {
    expect(resolveBackupPath(name)).toBe(path.join(root, name));
  });

  it("resolves names before the backup directory exists", () => {
    const missingRoot = path.join(fixture, "not-created", "backups");
    vi.stubEnv("BACKUP_DIR", missingRoot);
    expect(resolveBackupPath("backup.zip")).toBe(path.join(missingRoot, "backup.zip"));
  });

  it("accepts an existing regular backup", async () => {
    await writeFile(path.join(root, "existing.zip"), "test-backup");
    expect(resolveBackupPath("existing.zip")).toBe(path.join(root, "existing.zip"));
  });

  it("rejects a sibling sharing the backup directory prefix", () => {
    expect(() => resolveBackupPath("../backups-other/secret.zip")).toThrow();
  });

  it("rejects a symlink/junction at the backup filename without touching its target", async () => {
    const outside = path.join(fixture, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel"), "unchanged");
    await symlink(outside, path.join(root, "linked.zip"), "junction");
    expect(() => resolveBackupPath("linked.zip")).toThrow();
    expect(await readFile(path.join(outside, "sentinel"), "utf8")).toBe("unchanged");
  });

  it("rejects dangling symlinks/junctions", async () => {
    await symlink(path.join(fixture, "absent"), path.join(root, "dangling.zip"), "junction");
    expect(() => resolveBackupPath("dangling.zip")).toThrow();
  });

  it("rejects a symbolic link to a regular file outside storage", async ({ skip }) => {
    const outside = path.join(fixture, "private.zip");
    await writeFile(outside, "must-not-be-read-as-backup");
    try {
      await symlink(outside, path.join(root, "file-link.zip"), "file");
    } catch (error) {
      // Windows file symlinks require Developer Mode/SeCreateSymbolicLinkPrivilege. Junction tests
      // above still execute on Windows; Linux CI must execute this actual file-symlink regression.
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
        skip();
        return;
      }
      throw error;
    }
    expect(() => resolveBackupPath("file-link.zip")).toThrow();
    expect(await readFile(outside, "utf8")).toBe("must-not-be-read-as-backup");
  });

  it("rejects a symlink/junction in a backup directory ancestor", async () => {
    const destination = path.join(fixture, "actual");
    await mkdir(path.join(destination, "backups"), { recursive: true });
    const alias = path.join(fixture, "alias");
    await symlink(destination, alias, "junction");
    vi.stubEnv("BACKUP_DIR", path.join(alias, "backups"));
    expect(() => resolveBackupPath("backup.zip")).toThrow();
  });
});

